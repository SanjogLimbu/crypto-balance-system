import Link from "next/link"
import { redirect } from "next/navigation"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { unitsToUsdc } from "@/lib/constants"
import SignOutButton from "../components/SignOutButton"

//

export default async function Finance() {
    const session = await getServerSession(authOptions)

    if (!session?.user?.id) {
        redirect("/login")
    }


    // Read on every visit, so the balance is current whenever the user comes back here.
    const user = await prisma.user.findUnique({
        where: { id: session.user.id },
        select: { balanceUnits: true },
    })


    const entries = await prisma.balance_entry.findMany({
        where: {
            userId: session.user.id,
        },
        orderBy: {
            createdAt: "desc",
        },
        take: 50,
        select: {
            id: true,
            type: true,
            amountUnits: true,
            createdAt: true,
        },
    })


    return (
        <div className="w-full max-w-md">
            <div className="card p-6">
                <p className="label">
                    Available balance
                </p>

                <p className="mt-2 flex items-baseline gap-2">
                    <span className="text-4xl font-semibold tracking-tight tabular-nums">
                        {unitsToUsdc(user?.balanceUnits ?? 0n)}
                    </span>

                    <span className="text-muted">
                        USDC
                    </span>
                </p>

                <div className="mt-6 grid grid-cols-2 gap-3">
                    <Link 
                        href="/finance/deposit" 
                        className="btn btn-primary"
                    >
                        Deposit
                    </Link>

                    <Link 
                        href="/finance/withdraw" 
                        className={`btn ${(user?.balanceUnits || 0) > 0 ? "btn-primary" : "btn-secondary"}`}
                    >
                        Withdraw
                    </Link>
                </div>
            </div>

            <div className="card mt-10 p-6">
                <p className="label">
                    Ledger
                </p>

                <div className="mt-4 divide-y divide-white/10">
                    {entries.length === 0 ? (
                        <p className="py-4 text-sm text-muted">
                            No transactions yet.
                        </p>
                    ) : (
                        entries.map((entry) => (
                            <div
                                key={entry.id}
                                className="flex items-center justify-between gap-4 py-4"
                            >
                                <div className="min-w-0">
                                    <p className="text-sm font-medium capitalize">
                                        {entry.type}
                                    </p>

                                    <time
                                        dateTime={entry.createdAt.toISOString()}
                                        className="text-xs text-muted"
                                    >
                                        {entry.createdAt.toLocaleString("en-GB", {
                                            dateStyle: "medium",
                                            timeStyle: "short",
                                            timeZone: "UTC",
                                        })} UTC
                                    </time>
                                </div>

                                <p className="shrink-0 text-sm font-medium tabular-nums">
                                    {unitsToUsdc(entry.amountUnits)} USDC
                                </p>
                            </div>
                        ))
                    )}
                </div>
            </div>

            <SignOutButton />
        </div>
    )
}
