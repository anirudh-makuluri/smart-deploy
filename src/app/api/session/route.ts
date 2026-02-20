import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/authOptions";
import { dbHelper } from "@/db-helper";
import { getGithubRepos } from "@/github-helper";
import { repoType } from "@/app/types";

// Force dynamic rendering - prevents Next.js from analyzing this route during build
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
	try {
		const session = await getServerSession(authOptions)

		const userID = session?.userID
		const name = session?.user?.name
		const image = session?.user?.image
		const token = session?.accessToken

		if (!userID || !name || !image || !token) {
			return NextResponse.json({ message: "Sufficient data not given" }, { status: 400 });
		}

		const createResult = await dbHelper.getOrCreateUser(userID, {
			name,
			image,
			createdAt: new Date().toISOString(),
		});
		if (createResult.error) {
			return NextResponse.json({ message: createResult.error }, { status: 500 });
		}

		const { repos: existingRepos } = await dbHelper.getUserRepos(userID);
		let repoList: repoType[] = [];

		if (!existingRepos || existingRepos.length === 0) {
			const response = await getGithubRepos(token);
			if (response.data) {
				repoList = response.data;
				await dbHelper.syncUserRepos(userID, repoList);
				console.log("Repos added for user");
			} else {
				console.log("Error occured while trying to add repos to user");
			}
		} else {
			console.log("Repos already exist for user");
			repoList = existingRepos;
		}

		return NextResponse.json({ 
			message: "User synced successfully",
			repoList
		}, 
			{ status: 200 }
		);

	} catch (error) {
		console.error("Error adding user:", error);
		return NextResponse.json({ message: "Internal Server Error" }, { status: 500 });
	}
}
