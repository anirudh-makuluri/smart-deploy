import fs from "fs";
import path from "path";

export interface DatabaseConfig {
	type: "mssql" | "postgres" | "mysql" | "mongodb" | "redis";
	connectionString?: string;
	host?: string;
	port?: number;
	database?: string;
	username?: string;
	password?: string;
	detectedFrom: string; // File or config where it was detected
}

/**
 * Detects database configuration from common config files
 */
export function detectDatabase(appDir: string, serviceDir?: string): DatabaseConfig | null {
	const searchDir = serviceDir || appDir;

	// Check for .NET connection strings (appsettings.json, appsettings.Development.json)
	const dotnetConfigs = [
		"appsettings.json",
		"appsettings.Development.json",
		"appsettings.Production.json"
	];

	for (const configFile of dotnetConfigs) {
		const configPath = path.join(searchDir, configFile);
		if (fs.existsSync(configPath)) {
			try {
				const content = fs.readFileSync(configPath, "utf-8");
				const config = JSON.parse(content);
				
				// Check ConnectionStrings section
				if (config.ConnectionStrings) {
					for (const [key, connStr] of Object.entries(config.ConnectionStrings)) {
						const dbConfig = parseConnectionString(connStr as string);
						if (dbConfig) {
							return {
								...dbConfig,
								detectedFrom: configFile
							};
						}
					}
				}
			} catch (error) {
				// Continue to next file
			}
		}
	}

	// Check for environment files (.env)
	const envPath = path.join(searchDir, ".env");
	if (fs.existsSync(envPath)) {
		try {
			const content = fs.readFileSync(envPath, "utf-8");
			const lines = content.split("\n");
			
			for (const line of lines) {
				if (line.includes("DATABASE_URL") || 
					line.includes("DB_HOST") || 
					line.includes("CONNECTION_STRING") ||
					line.includes("MSSQL") ||
					line.includes("SQL_SERVER")) {
					const match = line.match(/(?:DATABASE_URL|DB_HOST|CONNECTION_STRING|MSSQL|SQL_SERVER)[=:]\s*(.+)/i);
					if (match) {
						const connStr = match[1].trim();
						const dbConfig = parseConnectionString(connStr);
						if (dbConfig) {
							return {
								...dbConfig,
								detectedFrom: ".env"
							};
						}
					}
				}
			}
		} catch (error) {
			// Continue
		}
	}

	// Check for docker-compose database services
	const composeFiles = [
		"docker-compose.yml",
		"docker-compose.yaml",
		"compose.yml",
		"compose.yaml"
	];

	for (const file of composeFiles) {
		const composePath = path.join(appDir, file);
		if (fs.existsSync(composePath)) {
			try {
				const content = fs.readFileSync(composePath, "utf-8");
				// Simple detection - look for database image names
				if (content.includes("mssql") || content.includes("sqlserver")) {
					return {
						type: "mssql",
						detectedFrom: file
					};
				}
				if (content.includes("postgres")) {
					return {
						type: "postgres",
						detectedFrom: file
					};
				}
				if (content.includes("mysql")) {
					return {
						type: "mysql",
						detectedFrom: file
					};
				}
			} catch (error) {
				// Continue
			}
		}
	}

	return null;
}

/**
 * Parses a connection string to extract database information
 */
function parseConnectionString(connStr: string): DatabaseConfig | null {
	if (!connStr) return null;

	// MSSQL connection string patterns
	if (connStr.includes("Server=") || connStr.includes("Data Source=") || connStr.includes("mssql://")) {
		const config: DatabaseConfig = {
			type: "mssql",
			detectedFrom: "connection_string"
		};

		// Parse Server/Data Source
		const serverMatch = connStr.match(/(?:Server|Data Source)=([^;]+)/i);
		if (serverMatch) {
			const server = serverMatch[1].trim();
			const [host, port] = server.split(",");
			config.host = host?.trim();
			if (port) {
				config.port = parseInt(port.trim());
			} else {
				config.port = 1433; // Default MSSQL port
			}
		}

		// Parse Database/Initial Catalog
		const dbMatch = connStr.match(/(?:Database|Initial Catalog)=([^;]+)/i);
		if (dbMatch) {
			config.database = dbMatch[1].trim();
		}

		// Parse User ID
		const userMatch = connStr.match(/(?:User ID|User)=([^;]+)/i);
		if (userMatch) {
			config.username = userMatch[1].trim();
		}

		// Parse Password
		const passMatch = connStr.match(/Password=([^;]+)/i);
		if (passMatch) {
			config.password = passMatch[1].trim();
		}

		config.connectionString = connStr;
		return config;
	}

	// PostgreSQL connection string
	if (connStr.includes("postgres://") || connStr.includes("postgresql://")) {
		return {
			type: "postgres",
			connectionString: connStr,
			detectedFrom: "connection_string"
		};
	}

	// MySQL connection string
	if (connStr.includes("mysql://")) {
		return {
			type: "mysql",
			connectionString: connStr,
			detectedFrom: "connection_string"
		};
	}

	return null;
}
