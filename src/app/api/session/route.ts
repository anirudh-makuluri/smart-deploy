import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/firebaseAdmin";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/authOptions";
import { dbHelper } from "@/db-helper";
import { getGithubRepos } from "@/github-helper";
import { repoType } from "@/app/types";

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

		const userRef = db.collection("users").doc(userID);
		const doc = await userRef.get();

		if (!doc.exists) {
			await userRef.set({ name, image, createdAt: new Date().toISOString() });
		}

		const reposSnapshot = await userRef.collection("repos").get();

		let repoList : repoType[] = []
		if (reposSnapshot.empty) {
			const response = await getGithubRepos(token);
			if(response.data) {
				repoList = response.data
				await dbHelper.syncUserRepos(userID, repoList);
				console.log("✅ Repos added for user");
			} else {
				console.log("Error occured while trying to add repos to user")
			}			
		} else {
			console.log("ℹ️ Repos already exist for user");
  			reposSnapshot.forEach((doc) => repoList.push(doc.data() as repoType));
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
