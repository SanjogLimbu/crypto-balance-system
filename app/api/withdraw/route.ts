import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { processWithdraw } from "@/lib/crypto"
import { usdcToUnits, unitsToUsdc, MIN_WITHDRAW_AMOUNT_UNITS } from "@/lib/constants"
import { isAddress } from "viem"

//

export async function POST(request: Request) {
    const session = await getServerSession(authOptions)

    if (!session?.user?.id) {
        return NextResponse.json(
            { error: "Unauthorized" },
            { status: 401 }
        )
    }


    // A body that is not JSON, or is null, becomes {} and fails the checks below.
    const data = await request.json().catch(() => null) ?? {}
    const amount = data.amount
    const address = data.address

    if (!amount || typeof amount !== "string") {
        return NextResponse.json(
            { error: "Invalid amount." },
            { status: 400 }
        )
    }


    let amountUnits: bigint

    try {
        amountUnits = usdcToUnits(amount)
    }
    catch {
        return NextResponse.json(
            { error: "Invalid amount." },
            { status: 400 }
        )
    }


    if (amountUnits < MIN_WITHDRAW_AMOUNT_UNITS) {
        return NextResponse.json(
            { error: `Minimum withdraw is ${unitsToUsdc(MIN_WITHDRAW_AMOUNT_UNITS)}` }, 
            { status: 400 }
        )
    }


    if (!address || typeof address !== "string" || !isAddress(address)) {
        return NextResponse.json(
            { error: "Invalid wallet address." }, 
            { status: 400 }
        )
    }


    try {
        const result = await processWithdraw(session.user.id, amountUnits, address)

        if (!result) {
            return NextResponse.json(
                { error: "Insufficient balance." }, 
                { status: 400 }
            )
        }


        return NextResponse.json(result)
    }
    catch (error) {
        console.error("[withdraw] failed:", error)

        return NextResponse.json(
            { error: "Withdrawal failed." }, 
            { status: 500 }
        )
    }
}

