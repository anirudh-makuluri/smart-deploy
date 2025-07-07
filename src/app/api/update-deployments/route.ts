import { NextRequest, NextResponse } from "next/server";
import { DeployConfig } from "@/app/types";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]/route";
import { dbHelper } from "@/db-helper";

export async function POST(req: NextRequest) {
	try {
		const deployConfig  = await req.json();
		const session = await getServerSession(authOptions)

		const token = session?.accessToken
		const userID = session?.userID

		if (!token) {
			return NextResponse.json({ error: "Missing access token" }, { status: 401 });
		}

		if (!userID) {
			return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
		}

		const response = await dbHelper.updateDeployments(deployConfig, userID);

		if(response.success) {
			return NextResponse.json({ status: "success", message : response.success});
		} else {
			return NextResponse.json({ status: "error", message : response.error});
		}
	} catch (error: any) {
		console.error("Deployment error:", error);
		return NextResponse.json({ error: error.message }, { status: 500 });
	}
}

