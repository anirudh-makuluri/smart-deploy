import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/firebaseAdmin";
import { getServerSession } from "next-auth";

import { dbHelper } from "@/db-helper";
import { authOptions } from "../auth/authOptions";

export async function GET(req: NextRequest) {
	try {
		const session = await getServerSession(authOptions)

		const userID = session?.userID

		if (!userID) {
			return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
		}

		const response = await dbHelper.getUserDeployments(userID);

		if (response.deployments) {
			return NextResponse.json({ status: "success", deployments: response.deployments })
		} else {
			return NextResponse.json({ status: "error", message: response.error })
		}

	} catch (error) {
		return NextResponse.json({ status: "error", message: error })
	}
}