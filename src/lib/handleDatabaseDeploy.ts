import config from "../config";
import { runCommandLiveWithWebSocket } from "../server-helper";
import { DatabaseConfig } from "./databaseDetector";
import { createWebSocketLogger } from "./websocketLogger";

/**
 * Creates a Cloud SQL instance for MSSQL
 */
export async function createCloudSQLInstance(
	dbConfig: DatabaseConfig,
	projectId: string,
	instanceName: string,
	ws: any
): Promise<{ connectionName: string, ipAddress: string }> {
	const send = createWebSocketLogger(ws);

	send(`🗄️ Creating Cloud SQL ${dbConfig.type.toUpperCase()} instance: ${instanceName}...`, 'database');
	send(`ℹ️ Note: This may take several minutes. Cloud SQL API must be enabled.`, 'database');

	// Cloud SQL instance creation command
	const createArgs = [
		"sql", "instances", "create", instanceName,
		"--database-version", getDatabaseVersion(dbConfig.type),
		"--tier", "db-f1-micro", // Start with smallest tier (can be upgraded)
		"--region", "us-central1",
		"--root-password", generatePassword(),
		"--storage-type", "SSD",
		"--storage-size", "10GB",
		"--storage-auto-increase"
	];

	try {
		await runCommandLiveWithWebSocket("gcloud", createArgs, ws, 'database');
		send(`✅ Cloud SQL instance created: ${instanceName}`, 'database');
	} catch (error: any) {
		const errorMsg = error.message || String(error);
		
		// Check if it's an API not enabled error
		if (errorMsg.includes("API") || errorMsg.includes("not enabled")) {
			send(`❌ Cloud SQL Admin API is not enabled. Please enable it with:`, 'database');
			send(`   gcloud services enable sqladmin.googleapis.com`, 'database');
			throw new Error(`Cloud SQL Admin API must be enabled. Run: gcloud services enable sqladmin.googleapis.com`);
		}
		
		// Instance might already exist, check if it does
		send(`ℹ️ Checking if instance already exists...`, 'database');
		try {
			await runCommandLiveWithWebSocket("gcloud", [
				"sql", "instances", "describe", instanceName
			], ws, 'database');
			send(`ℹ️ Instance already exists, using existing instance`, 'database');
		} catch {
			throw new Error(`Failed to create Cloud SQL instance: ${errorMsg}. Make sure Cloud SQL Admin API is enabled.`);
		}
	}

	// Get connection name
	const connectionName = `${projectId}:us-central1:${instanceName}`;

	// Get IP address
	const ipOutput = await runCommandLiveWithWebSocket("gcloud", [
		"sql", "instances", "describe", instanceName,
		"--format=value(ipAddresses[0].ipAddress)"
	], ws, 'database');

	const ipAddress = ipOutput.trim();

	// Create database if specified
	if (dbConfig.database) {
		send(`📊 Creating database: ${dbConfig.database}...`, 'database');
		try {
			await runCommandLiveWithWebSocket("gcloud", [
				"sql", "databases", "create", dbConfig.database,
				"--instance", instanceName
			], ws, 'database');
		} catch (error: any) {
			// Database might already exist
			send(`ℹ️ Database might already exist, continuing...`, 'database');
		}
	}

	return { connectionName, ipAddress };
}

/**
 * Gets the Cloud SQL database version string for gcloud
 */
function getDatabaseVersion(dbType: string): string {
	const versions: Record<string, string> = {
		mssql: "SQLSERVER_2019_STANDARD",
		postgres: "POSTGRES_15",
		mysql: "MYSQL_8_0"
	};
	return versions[dbType] || versions.mssql;
}

/**
 * Generates a secure random password
 */
function generatePassword(): string {
	const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*";
	let password = "";
	for (let i = 0; i < 16; i++) {
		password += chars.charAt(Math.floor(Math.random() * chars.length));
	}
	return password;
}

/**
 * Configures Cloud Run service to connect to Cloud SQL
 */
export async function connectCloudRunToCloudSQL(
	serviceName: string,
	connectionName: string,
	ws: any
): Promise<void> {
	const send = createWebSocketLogger(ws);

	send(`🔗 Connecting Cloud Run service to Cloud SQL...`, 'database');

	await runCommandLiveWithWebSocket("gcloud", [
		"run", "services", "update", serviceName,
		"--region", "us-central1",
		"--add-cloudsql-instances", connectionName
	], ws, 'database');

	send(`✅ Cloud Run service connected to Cloud SQL`, 'database');
}

/**
 * Generates Cloud SQL connection string for the application
 */
export function generateCloudSQLConnectionString(
	dbConfig: DatabaseConfig,
	connectionName: string,
	ipAddress: string,
	database?: string
): string {
	const dbName = database || dbConfig.database || "master";
	
	switch (dbConfig.type) {
		case "mssql":
			// Cloud SQL connection string format for MSSQL
			// Format: Server=/cloudsql/PROJECT_ID:REGION:INSTANCE_NAME;Database=DB_NAME;User Id=USER;Password=PASSWORD;
			return `Server=/cloudsql/${connectionName};Database=${dbName};User Id=${dbConfig.username || "sqlserver"};Password=${dbConfig.password || ""};`;
		
		case "postgres":
			return `postgresql://${dbConfig.username || "postgres"}:${dbConfig.password || ""}@/${dbName}?host=/cloudsql/${connectionName}`;
		
		case "mysql":
			return `mysql://${dbConfig.username || "root"}:${dbConfig.password || ""}@/${dbName}?unix_socket=/cloudsql/${connectionName}`;
		
		default:
			return `Server=/cloudsql/${connectionName};Database=${dbName};`;
	}
}
