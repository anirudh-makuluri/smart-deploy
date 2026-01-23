import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../../auth/authOptions";
import { dbHelper } from "@/db-helper";
import { repoType } from "@/app/types";
import { getGithubRepos } from "@/github-helper";


export async function GET(req: NextRequest) {
	const session = await getServerSession(authOptions)

	const token = session?.accessToken
	const userID = session?.userID

	if (!token) {
		return NextResponse.json({ error: "Missing access token" }, { status: 401 });
	}

	if (!userID) {
		return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
	}

	try {
		const response = await getGithubRepos(token);
		if (response.data) {
			const repoList: repoType[] = response.data
			await dbHelper.syncUserRepos(userID, repoList);
			console.log("✅ Repos added for user");
			return NextResponse.json({
				status: "success",
				message: "User synced successfully",
				repoList
			},
				{ status: 200 }
			);
		} else {
			console.log("Error occured while trying to add repos to user")
			return NextResponse.json({
				status: "error",
				message: "Error occured while trying to add repos to user",
			}, { status: 500 })	
		}
	} catch (err: any) {
		return NextResponse.json({ error: err.message }, { status: 500 });
	}
}
