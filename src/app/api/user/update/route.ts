import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/firebaseAdmin";
import { getServerSession } from "next-auth";
import { authOptions } from "../../auth/[...nextauth]/route";
import { dbHelper } from "@/db-helper";

export async function PUT(req: NextRequest) {
	try {
		const session = await getServerSession(authOptions)

		const userID = session?.userID

		if(!userID) {
			return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
		}

		const data = await req.json();

		const message = await dbHelper.updateUser(userID, data)

		if(message.success) {
			return NextResponse.json({ message: "Updated successfully" });
		} else {
			return NextResponse.json({ message: message.error }, { status: 400 });
		}
		
	} catch (error) {
		console.error("Error adding user:", error);
		return NextResponse.json({ message: "Internal Server Error" }, { status: 500 });
	}
}