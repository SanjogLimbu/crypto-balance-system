import { mnemonicToAccount, privateKeyToAccount } from "viem/accounts"
import { prisma } from "./db"
import { DEPOSIT_WINDOW_MINUTES, MAX_BLOCK_RANGE, DEPOSIT_GRACE_MINUTES, MIN_AMOUNT_UNITS, SWEEP_CLAIM_MINUTES, WITHDRAWAL_FEE_PERCENT } from "./constants"
import { erc20Abi, parseAbiItem } from "viem"
import { publicClient, walletClient, USDC_ADDRESS } from "./chain"

const TRANSFER_EVENT = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)")
const MAIN_WALLET_ADDRESS = process.env.MAIN_WALLET_ADDRESS as `0x${string}`
const PROFIT_WALLET_ADDRESS = process.env.PROFIT_WALLET_ADDRESS as `0x${string}`

//

function depositAccount(index: number) {
    return mnemonicToAccount(process.env.DEPOSIT_MNEMONIC!, { addressIndex: index })
}


function mainAccount() {
    return privateKeyToAccount(`0x${process.env.WALLET_PRIVATE_KEY}`)
}


// The contract call for sending USDC, in the shape viem's contract functions take.
function usdcTransfer(to: `0x${string}`, amountUnits: bigint) {
    return {
        address: USDC_ADDRESS,
        abi: erc20Abi,
        functionName: "transfer",
        args: [to, amountUnits],
    } as const
}

//

export async function createDeposit(userId: string, amountUnits: bigint) {
    const expiresAt = new Date(Date.now() + DEPOSIT_WINDOW_MINUTES * 60 * 1000)

    return prisma.$transaction(async (tx) => {
        // Locks this user's row until the transaction ends, so a second request from them waits here.
        await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`

        const pending = await tx.crypto_deposit.findFirst({
            where: { 
                userId,
                status: "pending",
                expiresAt: { gt: new Date() }
            } 
        })


        // Try user's already created address that's pending to avoid waste and to reduce number of addresses that need to be watched.
        if (pending) {
            const { count } = await tx.crypto_deposit.updateMany({
                where: {
                    id: pending.id,
                    status: "pending"
                },
                data: {
                    amountUnits,
                    expiresAt
                }
            })

            
            if (count > 0) {
                return {
                    address: pending.address,
                    amountUnits: amountUnits.toString()
                } 
            }
        }


        // Get a new unique address for user.
        const counter = await tx.deposit_counter.upsert({
            where: { 
                id: "global" 
            },
            update: { 
                value: { increment: 1 } 
            },
            create: { 
                id: "global", value: 1, lastBlock: BigInt(0) 
            },
        })


        const index = counter.value
        const address = depositAccount(index).address

        await tx.crypto_deposit.create({
            data: { 
                userId, 
                address, 
                index, 
                amountUnits, 
                expiresAt 
            },
        })


        return {
            address,
            amountUnits: amountUnits.toString(),
        }
    })
}


export async function getDepositStatus(address: string, userId: string) {
    await prisma.crypto_deposit.updateMany({
        where: { 
            userId,
            address,
            expiresAt: { lt: new Date() },
            status: {
                in: ["pending"]
            }
        },
        data: { status: "expired" } 
    })


    const deposit = await prisma.crypto_deposit.findUnique({
        where: { userId, address }
    })


    if (!deposit) {
        return null 
    }


    return deposit.status
}


function creditDeposit(
    deposit: { 
        id: string, 
        userId: string 
    }, 
    value: bigint, 
    txHash: string,
    logIndex: number,
    blockNumber: bigint
) {
    return prisma.$transaction(async (tx) => {
        // One row per transfer: the unique (txHash, logIndex) skips a transfer that was already credited.
        const { count } = await tx.deposit_transfer.createMany({
            data: [{
                depositId: deposit.id,
                txHash,
                logIndex,
                amountUnits: value,
                blockNumber
            }],
            skipDuplicates: true,
        })


        if (count === 0) {
            return false
        }


        // User row before deposit row, the order createDeposit locks them in, so the two cannot deadlock.
        await tx.user.update({
            where: { id: deposit.userId },
            data: { balanceUnits: { increment: value } }
        })


        // Clearing the sweep claim makes the next sweep pick this address up again.
        await tx.crypto_deposit.update({
            where: {
                id: deposit.id
            },
            data: {
                status: "confirmed",
                txHash,
                blockNumber,
                confirmedAt: new Date(),
                sweepStartedAt: null
            },
        })

        
        return true
    })
}


export async function processDeposits() {
    const latest = await publicClient.getBlockNumber()
    const { number: finalized } = await publicClient.getBlock({ blockTag: "finalized" })

    const counter = await prisma.deposit_counter.upsert({
        where: { 
            id: "global" 
        },
        update: {},
        create: { 
            id: "global", value: 0, lastBlock: finalized 
        },
    })


    // Whatever its status, an address stays watched until 24 hours after it expires, so late and repeated transfers still get credited.
    const watched = await prisma.crypto_deposit.findMany({
        where: {
            expiresAt: {
                gt: new Date(Date.now() - DEPOSIT_GRACE_MINUTES * 60 * 1000) 
            },
        },
    })


    let fromBlock = counter.lastBlock + 1n

    if (counter.lastBlock === 0n) {
        fromBlock = finalized - MAX_BLOCK_RANGE + 1n
    }


    let toBlock = latest
    let credited = 0

    if (watched.length > 0 && fromBlock <= latest) {
        if (latest - fromBlock >= MAX_BLOCK_RANGE) {
            toBlock = fromBlock + MAX_BLOCK_RANGE - 1n
        }


        const logs = await publicClient.getLogs({
            address: USDC_ADDRESS,
            event: TRANSFER_EVENT,
            args: { to: watched.map(deposit => deposit.address as `0x${string}`) },
            fromBlock,
            toBlock,
            strict: true,
        })

        
        for (const log of logs) {
            const deposit = watched.find(deposit => deposit.address.toLowerCase() === log.args.to.toLowerCase())

            if (!deposit || log.args.value < MIN_AMOUNT_UNITS) {
                continue
            }


            if (log.blockNumber > finalized) {
                await prisma.crypto_deposit.updateMany({
                    where: { 
                        id: deposit.id, 
                        status: { in: ["pending", "detected"] } 
                    },
                    data: { 
                        status: "detected", 
                        txHash: log.transactionHash, 
                        blockNumber: log.blockNumber 
                    },
                })


                continue
            }


            if (await creditDeposit(deposit, log.args.value, log.transactionHash, log.logIndex, log.blockNumber)) {
                credited++
            }
        }
    }


    const lastBlock = toBlock < finalized ? toBlock : finalized

    await prisma.crypto_deposit.updateMany({
        where: { 
            status: "detected", 
            blockNumber: { lte: lastBlock } 
        },
        data: { 
            status: "pending", 
            txHash: null, 
            blockNumber: null 
        },
    })


    await prisma.crypto_deposit.updateMany({
        where: { 
            status: "pending", 
            expiresAt: { lt: new Date() } 
        },
        data: { 
            status: "expired" 
        },
    })


    await prisma.deposit_counter.update({ 
        where: { 
            id: "global" 
        }, 
        data: { 
            lastBlock 
        } 
    })


    return credited
}


export async function sweepDeposits() {
    const deposits = await prisma.crypto_deposit.findMany({ 
        where: { status: "confirmed" } 
    })

    
    let swept = 0

    for (const deposit of deposits) {
        const claimedAt = new Date()


        // Check if deposit is free and write it as claimed happen in a single step to avoid collisions. 
        // Crashes may occur so if sweep started more than SWEEP_CLAIM_MINUTES ago, but its status is not updated, assume it crashed and allow takeover.
        const { count } = await prisma.crypto_deposit.updateMany({
            where: {
                id: deposit.id,
                status: "confirmed",
                OR: [
                    { sweepStartedAt: null },
                    { sweepStartedAt: { lt: new Date(Date.now() - SWEEP_CLAIM_MINUTES * 60 * 1000) } },
                ],
            },
            data: { sweepStartedAt: claimedAt },
        })


        if (count === 0) {
            continue
        }


        try {
            const account = depositAccount(deposit.index)

            const balance = await publicClient.readContract({
                address: USDC_ADDRESS,
                abi: erc20Abi,
                functionName: "balanceOf",
                args: [account.address],
            })


            // Nothing left means an earlier run already moved it but died before saving that.
            if (balance > 0n) {
                const transfer = usdcTransfer(MAIN_WALLET_ADDRESS, balance)
                const gas = await publicClient.estimateContractGas({ ...transfer, account: account.address })
                const { maxFeePerGas, maxPriorityFeePerGas } = await publicClient.estimateFeesPerGas()
                const gasCost = gas * maxFeePerGas
                const gasBalance = await publicClient.getBalance({ address: account.address })


                // The deposit address pays the gas for its own transfer, so it needs that much POL first.
                if (gasBalance < gasCost) {
                    const pol = gasCost - gasBalance
                    const hash = await walletClient(mainAccount()).sendTransaction({ to: account.address, value: pol })

                    await publicClient.waitForTransactionReceipt({ hash })
                }


                const hash = await walletClient(account).writeContract({ ...transfer, gas, maxFeePerGas, maxPriorityFeePerGas })
                const receipt = await publicClient.waitForTransactionReceipt({ hash })

                if (receipt.status !== "success") {
                    throw new Error(`sweep transfer reverted: ${hash}`)
                }
            }


            await prisma.$transaction([
                prisma.crypto_deposit.update({
                    where: {
                        id: deposit.id,
                        status: "confirmed",
                        sweepStartedAt: claimedAt
                    },
                    data: {
                        status: "swept",
                        sweptAt: new Date() 
                    },
                }),

                prisma.balance_entry.create({ 
                    data: { 
                        userId: deposit.userId,
                        operationRef: deposit.id, 
                        type: "deposit",
                        amountUnits: deposit.amountUnits
                    },
                }),
            ])


            swept++
        }
        catch (error) {
            console.error(`[sweep] deposit ${deposit.id} failed:`, error)
        }
    }


    return swept
}


export async function processWithdraw(userId: string, amountUnits: bigint, address: `0x${string}`) {
    const feeUnits = amountUnits * WITHDRAWAL_FEE_PERCENT / 100n
    const netUnits = amountUnits - feeUnits

    const withdrawal = await prisma.$transaction(async (tx) => {
        const { count } = await tx.user.updateMany({
            where: { 
                id: userId, 
                balanceUnits: { gte: amountUnits } 
            },
            data: { 
                balanceUnits: { decrement: amountUnits } 
            },
        })


        if (count === 0) {
            return null
        }


        return tx.withdrawal.create({ 
            data: { userId, address, amountUnits, feeUnits } 
        })
    })


    if (!withdrawal) {
        return null
    }


    // Marks it failed and gives the balance back, both or neither.
    const refund = () => prisma.$transaction([
        prisma.withdrawal.update({ 
            where: { id: withdrawal.id }, 
            data: { status: "failed" } 
        }),

        prisma.user.update({ 
            where: { id: userId }, 
            data: { 
                balanceUnits: { increment: amountUnits } 
            } 
        }),
    ])


    const wallet = walletClient(mainAccount())
    let transactionHash: `0x${string}`

    try {
        transactionHash = await wallet.writeContract(usdcTransfer(address, netUnits))
    }
    catch (error) {
        await refund()

        throw error
    }


    await prisma.withdrawal.update({ 
        where: { id: withdrawal.id }, 
        data: { txHash: transactionHash } 
    })


    const receipt = await publicClient.waitForTransactionReceipt({ hash: transactionHash })

    // A reverted transaction still has a receipt.
    if (receipt.status !== "success") {
        await refund()

        throw new Error(`withdrawal reverted: ${transactionHash}`)
    }


    prisma.$transaction([
        prisma.withdrawal.update({ 
            where: { id: withdrawal.id }, 
            data: { status: "completed" } 
        }),

        prisma.balance_entry.create({ 
            data: { 
                userId,
                operationRef: withdrawal.id, 
                type: "withdrawal",
                amountUnits
            },
        }),
    ])


    // Best effort: if this fails the fee simply stays in the main wallet.
    try {
        await wallet.writeContract(usdcTransfer(PROFIT_WALLET_ADDRESS, feeUnits))
    }
    catch (error) {
        console.error(`[withdraw] fee transfer for ${withdrawal.id} failed:`, error)
    }


    return { transactionHash, amountUnits: netUnits.toString() }
}

