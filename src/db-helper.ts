import { db } from "@/lib/firebaseAdmin";
import { DeployConfig, DeploymentHistoryEntry, repoType } from "./app/types";


export const dbHelper = {
	updateUser: async function (userID: string, data: object) {
		try {
			if (!userID) {
				return { error: "userID not found" }
			}

			if (typeof data !== "object" || data === null) {
				return { message: "Invalid request" };
			}

			const userRef = db.collection("users").doc(userID);
			const doc = await userRef.get();

			if (!doc.exists) {
				return { error: "User doesnt exist" }
			}

			await userRef.set(data, { merge: true });

			console.log("User data updated successfully")

			return { success: "User data updated successfully" }
		} catch (error) {
			return { error }
		}

	},

	updateDeployments: async function (deployConfig: DeployConfig, userID: string) {
		try {
			const deploymentId = deployConfig.id;
			if (!deploymentId) return { error: "Deployment ID is required" };

			const userRef = db.collection("users").doc(userID);
			const userDoc = await userRef.get();

			if (!userDoc.exists) {
				return { error: "User doesn't exist" };
			}

			const deploymentRef = db.collection("deployments").doc(deploymentId);
			const deploymentDoc = await deploymentRef.get();

			if (deployConfig.status === 'stopped') {
				await dbHelper.deleteDeploymentHistory(deploymentId);
				await deploymentRef.delete();

				// Remove deployment ID from user's deploymentIds
				const userData = userDoc.data();
				if (userData && Array.isArray(userData.deploymentIds)) {
					const updatedIds = userData.deploymentIds.filter((id: string) => id !== deploymentId);
					await userRef.update({ deploymentIds: updatedIds });
				}

				return { success: "Deployment stopped and deleted" };
			}

			if (!deploymentDoc.exists) {
				await deploymentRef.set({
					ownerID: userID,
					status: deployConfig.status ?? 'running',
					first_deployment: new Date().toISOString(),
					last_deployment: new Date().toISOString(),
					revision: 1,
					...deployConfig
				});

				const userData = userDoc.data();
				const existingIds: string[] = userData?.deploymentIds || [];
				const updatedIds = existingIds.includes(deploymentId) ? existingIds : [...existingIds, deploymentId];
				await userRef.set(
					{ deploymentIds: updatedIds },
					{ merge: true }
				);
				return { success: "New deployment created and added to user" };
			} else {
				const data = deploymentDoc.data();
				if (data) {
					const revision = data['revision'] ? data['revision'] + 1 : 1;
					const last_deployment = new Date().toISOString()
					await deploymentRef.set({ revision, last_deployment, ...deployConfig }, { merge: true });
				} else {
					await deploymentRef.set(deployConfig, { merge: true });
				}

				return { success: "Deployment data updated successfully" };
			}
		} catch (error) {
			console.error("updateDeployments error:", error);
			return { error };
		}
	},

	/** Delete all documents in deployment's history subcollection (Firestore does not delete subcollections automatically). */
	deleteDeploymentHistory: async function (deploymentId: string) {
		const historyRef = db.collection("deployments").doc(deploymentId).collection("history");
		const batchSize = 500;
		let snapshot = await historyRef.limit(batchSize).get();
		while (!snapshot.empty) {
			const batch = db.batch();
			snapshot.docs.forEach((doc) => batch.delete(doc.ref));
			await batch.commit();
			snapshot = await historyRef.limit(batchSize).get();
		}
	},

	deleteDeployment: async function (deploymentId: string, userID: string) {
		try {
			if (!deploymentId || !userID) {
				return { error: "Deployment ID and user ID are required" };
			}

			const deploymentRef = db.collection("deployments").doc(deploymentId);
			const deploymentDoc = await deploymentRef.get();

			if (!deploymentDoc.exists) {
				return { success: "Deployment already deleted or not found" };
			}

			const data = deploymentDoc.data();
			if (data && data.ownerID !== userID) {
				return { error: "Unauthorized: deployment does not belong to user" };
			}

			await dbHelper.deleteDeploymentHistory(deploymentId);
			await deploymentRef.delete();

			const userRef = db.collection("users").doc(userID);
			const userDoc = await userRef.get();
			if (userDoc.exists) {
				const userData = userDoc.data();
				if (userData && Array.isArray(userData.deploymentIds)) {
					const updatedIds = userData.deploymentIds.filter((id: string) => id !== deploymentId);
					await userRef.update({ deploymentIds: updatedIds });
				}
			}

			return { success: "Deployment deleted" };
		} catch (error) {
			console.error("deleteDeployment error:", error);
			return { error };
		}
	},

	getUserDeployments: async function (userID: string) {
		try {
			const userRef = db.collection("users").doc(userID);
			const userDoc = await userRef.get();

			if (!userDoc.exists) {
				return { error: "User doesn't exist" };
			}

			const userData = userDoc.data();
			const deploymentIds: string[] = userData?.deploymentIds || [];

			if (deploymentIds.length === 0) {
				return { deployments: [] };
			}

			const deploymentPromises = deploymentIds.map(id =>
				db.collection("deployments").doc(id).get()
			);

			const deploymentDocs = await Promise.all(deploymentPromises);

			const deployments = deploymentDocs
				.filter(doc => doc.exists)
				.map(doc => ({ id: doc.id, ...doc.data() }));

			return { deployments };
		} catch (error) {
			console.error("getUserDeployments error:", error);
			return { error };
		}
	},
	syncUserRepos: async function (userID: string, repoList: repoType[]) {
		const userRef = db.collection("users").doc(userID);
		const reposRef = userRef.collection("repos");

		// Create a batch
		const batch = db.batch();

		repoList.forEach((repo) => {
			const docRef = reposRef.doc(repo.name);
			// Use merge to update if exists or create if not
			batch.set(docRef, repo, { merge: true });
		});

		await batch.commit();

		console.log(`Synced ${repoList.length} repos for user: ${userID}`);
	},

	addDeploymentHistory: async function (
		deploymentId: string,
		userID: string,
		entry: Omit<DeploymentHistoryEntry, "id" | "deploymentId">
	) {
		console.log("deploymentId", deploymentId);
		console.log("userID", userID);
		console.log("entry", entry);
		try {
			const deploymentRef = db.collection("deployments").doc(deploymentId);
			const deploymentDoc = await deploymentRef.get();
			if (!deploymentDoc.exists) return { error: "Deployment not found" };
			const data = deploymentDoc.data();
			if (data?.ownerID !== userID) return { error: "Unauthorized" };

			const historyRef = deploymentRef.collection("history").doc();
			const fullEntry: DeploymentHistoryEntry = {
				id: historyRef.id,
				deploymentId,
				...entry,
			};
			await historyRef.set(fullEntry);
			return { success: true, id: historyRef.id };
		} catch (error) {
			console.error("addDeploymentHistory error:", error);
			return { error };
		}
	},

	getDeploymentHistory: async function (deploymentId: string, userID: string) {
		try {
			const deploymentRef = db.collection("deployments").doc(deploymentId);
			const deploymentDoc = await deploymentRef.get();
			if (!deploymentDoc.exists) return { error: "Deployment not found" };
			const data = deploymentDoc.data();
			if (data?.ownerID !== userID) return { error: "Unauthorized" };

			const snapshot = await deploymentRef
				.collection("history")
				.orderBy("timestamp", "desc")
				.get();

			const history: DeploymentHistoryEntry[] = snapshot.docs.map((doc) => ({
				id: doc.id,
				deploymentId,
				...doc.data(),
			})) as DeploymentHistoryEntry[];

			return { history };
		} catch (error) {
			console.error("getDeploymentHistory error:", error);
			return { error };
		}
	},
}