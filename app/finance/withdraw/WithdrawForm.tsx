"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { MIN_AMOUNT_UNITS, WITHDRAWAL_FEE_PERCENT, unitsToUsdc, usdcToUnits } from "@/lib/constants"
import { AmountField, Panel, SuccessView } from "../ui"

//

// Zero while the field is empty or half typed.
function parseUnits(value: string) {
    try {
        return usdcToUnits(value)
    }
    catch {
        return 0n
    }
}

//

export default function WithdrawForm({ balanceUnits }: { balanceUnits: string }) {
    const router = useRouter()

    const [amountInput, setAmountInput] = useState("")
    const [address, setAddress] = useState("")
    const [error, setError] = useState("")
    const [loading, setLoading] = useState(false)
    const [result, setResult] = useState<{ transactionHash: string, amountUnits: string } | null>(null)

    const amountUnits = parseUnits(amountInput)
    const feeUnits = amountUnits * WITHDRAWAL_FEE_PERCENT / 100n

    // Rounded down to whole cents so "Max" never asks for more than the balance.
    const maxUnits = BigInt(balanceUnits) / 10_000n * 10_000n

    async function submit(event: React.SubmitEvent<HTMLFormElement>) {
        event.preventDefault()
        setLoading(true)
        setError("")

        try {
            const response = await fetch(
                "/api/withdraw",
                {
                    method: "POST",
                    body: JSON.stringify(
                        { 
                            amount: amountInput,
                            address 
                        }
                    ),
                }
            )


            const data = await response.json().catch(() => ({}))

            
            // Only a reply with a transaction hash counts as sent; an unknown route redirects and still answers 200.
            if (response.ok && data.transactionHash) {
                setResult(data)

                return
            }


            setError(data.error ?? "Withdrawal failed")
        }
        catch {
            setError("A network error occured.")
        }


        setLoading(false)
    }


    if (result) {
        return (
            <SuccessView title="Withdrawal sent" onDone={() => router.push("/finance")}>
                <p>
                    {unitsToUsdc(result.amountUnits)} USDC is on its way.
                </p>

                <a
                    href={`https://polygonscan.com/tx/${result.transactionHash}`}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-2 inline-block text-fg underline-offset-4 hover:underline"
                >
                    View on Polygonscan
                </a>
            </SuccessView>
        )
    }


    return (
        <Panel title="Withdraw" onBack={() => router.push("/finance")}>
            <form onSubmit={submit} className="flex flex-col gap-4">
                <AmountField
                    value={amountInput}
                    onChange={setAmountInput}
                    action={
                        <button
                            type="button"
                            onClick={() => setAmountInput(unitsToUsdc(maxUnits))}
                            className="cursor-pointer text-xs text-muted transition-colors hover:text-fg"
                        >
                            Max {unitsToUsdc(maxUnits)}
                        </button>
                    }
                />

                <label className="flex flex-col gap-1.5">
                    <span className="label">
                        Destination address
                    </span>

                    <input
                        type="text"
                        placeholder="0x…"
                        value={address}
                        onChange={(event) => setAddress(event.target.value)}
                        className="field font-mono text-[13px]"
                        spellCheck={false}
                        autoComplete="off"
                        required
                    />
                </label>

                {amountUnits >= MIN_AMOUNT_UNITS && (
                    <dl className="flex flex-col gap-2 rounded-lg border border-line bg-bg px-3 py-3">
                        <div className="flex justify-between text-muted">
                            <dt>
                                Fee ({WITHDRAWAL_FEE_PERCENT.toString()}%)
                            </dt>

                            <dd className="tabular-nums">
                                −{unitsToUsdc(feeUnits)} USDC
                            </dd>
                        </div>

                        <div className="flex justify-between font-medium">
                            <dt>
                                You receive
                            </dt>

                            <dd className="tabular-nums">
                                {unitsToUsdc(amountUnits - feeUnits)} USDC
                            </dd>
                        </div>
                    </dl>
                )}

                <p className="text-xs leading-relaxed text-muted">
                    Double-check the address is on Polygon.
                </p>

                {error && (
                    <p className="text-danger">
                        {error}
                    </p>
                )}

                <button type="submit" disabled={loading} className="btn btn-primary">
                    {loading ? "Sending…" : "Withdraw"}
                </button>
            </form>
        </Panel>
    )
}
