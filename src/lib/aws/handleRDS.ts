import config from "../../config";
import { DatabaseConfig } from "../databaseDetector";
import { 
	runAWSCommand, 
	getDefaultVpcId,
	getSubnetIds,
	ensureSecurityGroup,
	generateResourceName
} from "./awsHelpers";

/**
 * RDS engine mappings
 */
const RDS_ENGINES: Record<string, { engine: string; engineVersion: string; port: number }> = {
	mssql: { engine: 'sqlserver-ex', engineVersion: '15.00', port: 1433 },
	postgres: { engine: 'postgres', engineVersion: '15', port: 5432 },
	mysql: { engine: 'mysql', engineVersion: '8.0', port: 3306 }
};

/**
 * Generates a secure random password
 */
function generatePassword(): string {
	const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
	let password = "";
	for (let i = 0; i < 16; i++) {
		password += chars.charAt(Math.floor(Math.random() * chars.length));
	}
	return password;
}

/**
 * Creates a DB subnet group
 */
async function ensureDBSubnetGroup(
	groupName: string,
	subnetIds: string[],
	region: string,
	ws: any
): Promise<string> {
	const send = (msg: string, id: string) => {
		if (ws && ws.readyState === ws.OPEN) {
			const object = {
				type: 'deploy_logs',
				payload: { id, msg }
			};
			ws.send(JSON.stringify(object));
		}
	};

	try {
		await runAWSCommand([
			"rds", "describe-db-subnet-groups",
			"--db-subnet-group-name", groupName,
			"--region", region
		], ws, 'database');
		send(`DB subnet group ${groupName} already exists`, 'database');
		return groupName;
	} catch {
		// Create subnet group
	}

	send(`Creating DB subnet group: ${groupName}...`, 'database');
	await runAWSCommand([
		"rds", "create-db-subnet-group",
		"--db-subnet-group-name", groupName,
		"--db-subnet-group-description", `SmartDeploy DB subnet group`,
		"--subnet-ids", ...subnetIds,
		"--region", region
	], ws, 'database');

	return groupName;
}

/**
 * Creates an RDS instance
 */
export async function createRDSInstance(
	dbConfig: DatabaseConfig,
	projectName: string,
	region: string,
	ws: any
): Promise<{ endpoint: string; port: number; connectionString: string }> {
	const send = (msg: string, id: string) => {
		if (ws && ws.readyState === ws.OPEN) {
			const object = {
				type: 'deploy_logs',
				payload: { id, msg }
			};
			ws.send(JSON.stringify(object));
		}
	};

	const dbType = dbConfig.type || 'postgres';
	const engineConfig = RDS_ENGINES[dbType];
	
	if (!engineConfig) {
		throw new Error(`Unsupported database type: ${dbType}`);
	}

	const instanceId = generateResourceName(projectName, 'db');
	const masterUsername = dbConfig.username || 'admin';
	const masterPassword = dbConfig.password || generatePassword();
	const dbName = dbConfig.database || 'appdb';

	send(`Creating RDS ${dbType.toUpperCase()} instance: ${instanceId}...`, 'database');
	send(`Note: This may take 5-10 minutes.`, 'database');

	// Get networking info
	const vpcId = await getDefaultVpcId(ws);
	const subnetIds = await getSubnetIds(vpcId, ws);

	// Create DB subnet group
	const subnetGroupName = `${projectName}-db-subnet`;
	await ensureDBSubnetGroup(subnetGroupName, subnetIds, region, ws);

	// Create security group for RDS
	const securityGroupId = await ensureSecurityGroup(
		`${projectName}-rds-sg`,
		vpcId,
		`Security group for ${projectName} RDS instance`,
		ws
	);

	// Add inbound rule for database port
	try {
		await runAWSCommand([
			"ec2", "authorize-security-group-ingress",
			"--group-id", securityGroupId,
			"--protocol", "tcp",
			"--port", String(engineConfig.port),
			"--cidr", "0.0.0.0/0",
			"--region", region
		], ws, 'database');
	} catch {
		// Rule might already exist
	}

	// Check if instance already exists
	try {
		const existingOutput = await runAWSCommand([
			"rds", "describe-db-instances",
			"--db-instance-identifier", instanceId,
			"--query", "DBInstances[0].Endpoint.Address",
			"--output", "text",
			"--region", region
		], ws, 'database');

		const endpoint = existingOutput.trim();
		if (endpoint && endpoint !== 'None') {
			send(`RDS instance ${instanceId} already exists`, 'database');
			const connectionString = generateConnectionString(
				dbType,
				endpoint,
				engineConfig.port,
				dbName,
				masterUsername,
				masterPassword
			);
			return { endpoint, port: engineConfig.port, connectionString };
		}
	} catch {
		// Instance doesn't exist, create it
	}

	// Create RDS instance
	const createArgs = [
		"rds", "create-db-instance",
		"--db-instance-identifier", instanceId,
		"--db-instance-class", "db.t3.micro",
		"--engine", engineConfig.engine,
		"--master-username", masterUsername,
		"--master-user-password", masterPassword,
		"--allocated-storage", "20",
		"--vpc-security-group-ids", securityGroupId,
		"--db-subnet-group-name", subnetGroupName,
		"--publicly-accessible",
		"--backup-retention-period", "0",
		"--region", region
	];

	// Add database name for non-MSSQL databases
	if (dbType !== 'mssql') {
		createArgs.push("--db-name", dbName);
	}

	await runAWSCommand(createArgs, ws, 'database');

	// Wait for instance to be available
	send("Waiting for RDS instance to be available...", 'database');
	
	let attempts = 0;
	const maxAttempts = 60;
	let endpoint = '';

	while (attempts < maxAttempts) {
		try {
			const statusOutput = await runAWSCommand([
				"rds", "describe-db-instances",
				"--db-instance-identifier", instanceId,
				"--query", "DBInstances[0].[DBInstanceStatus,Endpoint.Address]",
				"--output", "text",
				"--region", region
			], ws, 'database');

			const [status, addr] = statusOutput.trim().split(/\s+/);
			
			if (status === 'available' && addr && addr !== 'None') {
				endpoint = addr;
				send(`RDS instance is available: ${endpoint}`, 'database');
				break;
			}

			send(`RDS status: ${status} (${attempts + 1}/${maxAttempts})`, 'database');
		} catch (error) {
			// Continue waiting
		}

		attempts++;
		await new Promise(resolve => setTimeout(resolve, 15000));
	}

	if (!endpoint) {
		throw new Error("RDS instance creation timed out");
	}

	// For MSSQL, create the database
	if (dbType === 'mssql') {
		send(`Note: For SQL Server, create database '${dbName}' manually or via migrations`, 'database');
	}

	const connectionString = generateConnectionString(
		dbType,
		endpoint,
		engineConfig.port,
		dbName,
		masterUsername,
		masterPassword
	);

	send(`RDS instance created successfully!`, 'database');
	send(`Endpoint: ${endpoint}:${engineConfig.port}`, 'database');

	return { endpoint, port: engineConfig.port, connectionString };
}

/**
 * Generates a connection string for the database type
 */
function generateConnectionString(
	dbType: string,
	host: string,
	port: number,
	database: string,
	username: string,
	password: string
): string {
	switch (dbType) {
		case 'mssql':
			return `Server=${host},${port};Database=${database};User Id=${username};Password=${password};TrustServerCertificate=True;`;
		case 'postgres':
			return `postgresql://${username}:${password}@${host}:${port}/${database}`;
		case 'mysql':
			return `mysql://${username}:${password}@${host}:${port}/${database}`;
		default:
			return `${host}:${port}/${database}`;
	}
}

/**
 * Deletes an RDS instance (for cleanup)
 */
export async function deleteRDSInstance(
	instanceId: string,
	region: string,
	ws: any
): Promise<void> {
	const send = (msg: string, id: string) => {
		if (ws && ws.readyState === ws.OPEN) {
			const object = {
				type: 'deploy_logs',
				payload: { id, msg }
			};
			ws.send(JSON.stringify(object));
		}
	};

	send(`Deleting RDS instance: ${instanceId}...`, 'database');
	
	await runAWSCommand([
		"rds", "delete-db-instance",
		"--db-instance-identifier", instanceId,
		"--skip-final-snapshot",
		"--region", region
	], ws, 'database');

	send(`RDS instance ${instanceId} deletion initiated`, 'database');
}
