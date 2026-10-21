import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { createDeposit } from "@/lib/crypto"
import { MIN_AMOUNT_UNITS, unitsToUsdc, usdcToUnits } from "@/lib/constants"

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


    if (amountUnits < MIN_AMOUNT_UNITS) {
        return NextResponse.json(
            { error: `Minimum deposit is ${unitsToUsdc(MIN_AMOUNT_UNITS)}` }, 
            { status: 400 }
        )
    }


    return NextResponse.json(await createDeposit(session.user.id, amountUnits))
}
