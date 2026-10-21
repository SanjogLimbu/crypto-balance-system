import { NextResponse } from "next/server"
import bcrypt from "bcrypt"
import { prisma } from "@/lib/db"
import { Prisma } from "@/lib/generated/prisma/client"

//

export async function POST(request: Request) {
    // A body that is not JSON, or is null, becomes {} and fails the checks below.
    const { username, password } = await request.json().catch(() => null) ?? {}

    if (typeof username !== "string" || !/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
        return NextResponse.json(
            { error: "Username must be 3-20 letters, numbers or underscores" }, 
            { status: 400 }
        )
    }
    else if (typeof password !== "string" || password.length < 5) {
        return NextResponse.json(
            { error: "Password must be at least 5 characters" }, 
            { status: 400 }
        )
    }


    try {
        await prisma.user.create({
            data: {
                name: username,
                password: await bcrypt.hash(password, 10),
            },
        })
    }
    catch (error) {
        // Unique constraint on name, which also covers two concurrent submits of the same username.
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
            return NextResponse.json({ error: "Username taken" }, { status: 409 })
        }


        throw error
    }


    return NextResponse.json({ ok: true })
}
