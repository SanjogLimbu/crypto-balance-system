"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { AmountField, Panel } from "../ui"

//

export default function DepositForm() {
    const router = useRouter()

    const [amountInput, setAmountInput] = useState("")
    const [error, setError] = useState("")
    const [loading, setLoading] = useState(false)

    async function submit(event: React.SubmitEvent<HTMLFormElement>) {
        event.preventDefault()
        setLoading(true)
        setError("")

        try {
            const response = await fetch(
                "/api/create-deposit",
                {
                    method: "POST",
                    body: JSON.stringify({ amount: amountInput }),
                }
            )


            const data = await response.json().catch(() => ({}))

            if (response.ok) {
                // The deposit gets its own URL, so a reload or the back button brings the user back to it.
                router.push(`/finance/deposit/${data.address}`)

                return
            }


            setError(data.error ?? "Failed to create deposit")
        }
        catch {
            setError("A network error occured.")
        }


        setLoading(false)
    }


    return (
        <Panel title="Deposit" onBack={() => router.push("/finance")}>
            <form onSubmit={submit} className="flex flex-col gap-4">
                <AmountField value={amountInput} onChange={setAmountInput} />

                <p className="text-xs leading-relaxed text-muted">
                    You&apos;ll get a one-time address on Polygon. Send only USDC on that network.
                </p>

                {error && (
                    <p className="text-danger">
                        {error}
                    </p>
                )}

                <button type="submit" disabled={loading} className="btn btn-primary">
                    {loading ? "Creating address…" : "Get deposit address"}
                </button>
            </form>
        </Panel>
    )
}
