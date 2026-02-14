import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../../auth/authOptions";
import { dbHelper } from "@/db-helper";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
	try {
		const session = await getServerSession(authOptions);
		const userID = session?.userID;
		if (!userID) {
			return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
		}

		const response = await dbHelper.getAllDeploymentHistory(userID);
		if (response.error) {
			return NextResponse.json(
				{ status: "error", message: response.error },
				{ status: 400 }
			);
		}

		return NextResponse.json({ status: "success", history: response.history });
	} catch (error) {
		return NextResponse.json({ status: "error", message: error }, { status: 500 });
	}
}
