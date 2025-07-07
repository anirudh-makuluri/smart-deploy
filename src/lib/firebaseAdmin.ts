import config from "@/config";
import { getApps, initializeApp, cert, App } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";

let app: App;

if (!getApps().length) {
	const serviceAccountJson = Buffer.from(
		config.FIREBASE_SERVICE_ACCOUNT_KEY as string,
		"base64"
	).toString("utf8");

	const serviceAccount = JSON.parse(serviceAccountJson);


	app = initializeApp({
		credential: cert(serviceAccount),
		storageBucket: config.FIREBASE_STORAGE_BUCKET,
	});
} else {
	app = getApps()[0];
}

const db = getFirestore(app);
const storage = getStorage(app);

export { db, storage };
