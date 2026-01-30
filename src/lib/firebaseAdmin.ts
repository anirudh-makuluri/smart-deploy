import config from "@/config";
import { getApps, initializeApp, cert, App } from "firebase-admin/app";
import { getFirestore, Firestore } from "firebase-admin/firestore";
import { getStorage, Storage } from "firebase-admin/storage";

const isBuildTime = process.env.NEXT_PHASE === 'phase-production-build' || 
                    process.env.NODE_ENV === 'production' && !process.env.FIREBASE_SERVICE_ACCOUNT_KEY;

let app: App | undefined;
let _db: Firestore | undefined;
let _storage: Storage | undefined;

function getApp(): App {
	if (app) {
		return app;
	}

	// During build time, skip initialization if env vars aren't available
	if (isBuildTime && (!config.FIREBASE_SERVICE_ACCOUNT_KEY || config.FIREBASE_SERVICE_ACCOUNT_KEY === "")) {
		throw new Error("FIREBASE_SERVICE_ACCOUNT_KEY is not configured (build time)");
	}

	// Check if we're in a build context (no env vars) - skip initialization
	if (!config.FIREBASE_SERVICE_ACCOUNT_KEY || config.FIREBASE_SERVICE_ACCOUNT_KEY === "") {
		// During runtime, this is an error
		throw new Error("FIREBASE_SERVICE_ACCOUNT_KEY is not configured");
	}

	if (!getApps().length) {
		try {
			const serviceAccountJson = Buffer.from(
				config.FIREBASE_SERVICE_ACCOUNT_KEY as string,
				"base64"
			).toString("utf8");

			if (!serviceAccountJson || serviceAccountJson.trim() === "") {
				throw new Error("FIREBASE_SERVICE_ACCOUNT_KEY decodes to empty string");
			}

			// Validate JSON before parsing
			if (serviceAccountJson.trim().length === 0) {
				throw new SyntaxError("Empty JSON string");
			}

			const serviceAccount = JSON.parse(serviceAccountJson);

			app = initializeApp({
				credential: cert(serviceAccount),
				storageBucket: config.FIREBASE_STORAGE_BUCKET,
			});
		} catch (error) {
			if (error instanceof SyntaxError) {
				throw new Error(`Invalid JSON in FIREBASE_SERVICE_ACCOUNT_KEY: ${error.message}. Make sure the key is base64 encoded valid JSON.`);
			}
			throw error;
		}
	} else {
		app = getApps()[0];
	}

	return app;
}

// Lazy getters - only initialize when accessed
function getDb(): Firestore {
	if (!_db) {
		try {
			_db = getFirestore(getApp());
		} catch (error) {
			// During build time, if Firebase can't initialize, create a mock
			// This will fail at runtime if env vars aren't set, which is expected
			throw error;
		}
	}
	return _db;
}

function getStorageInstance(): Storage {
	if (!_storage) {
		try {
			_storage = getStorage(getApp());
		} catch (error) {
			throw error;
		}
	}
	return _storage;
}

// Use getter functions - initialize only when actually called
// This prevents initialization during build if env vars aren't available
let dbInitialized = false;
let storageInitialized = false;

// Proxy-based lazy initialization - only initializes when first property is accessed
export const db = new Proxy({} as Firestore, {
	get(_target, prop) {
		if (!dbInitialized) {
			try {
				_db = getFirestore(getApp());
				dbInitialized = true;
			} catch (error) {
				// During build, if env vars aren't available, this will fail
				// But the Proxy allows the module to be imported without immediate execution
				// The error will only occur when the route actually tries to use db
				const errorMessage = error instanceof Error ? error.message : String(error);
				throw new Error(`Firebase initialization failed: ${errorMessage}. This may occur during build if environment variables are not set.`);
			}
		}
		if (!_db) {
			throw new Error("Firebase db not initialized");
		}
		return (_db as any)[prop];
	}
}) as Firestore;

export const storage = new Proxy({} as Storage, {
	get(_target, prop) {
		if (!storageInitialized) {
			try {
				_storage = getStorage(getApp());
				storageInitialized = true;
			} catch (error) {
				const errorMessage = error instanceof Error ? error.message : String(error);
				throw new Error(`Firebase storage initialization failed: ${errorMessage}`);
			}
		}
		if (!_storage) {
			throw new Error("Firebase storage not initialized");
		}
		return (_storage as any)[prop];
	}
}) as Storage;
