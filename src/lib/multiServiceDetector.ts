import fs from "fs";
import path from "path";
import yaml from "js-yaml";

export interface ServiceDefinition {
	name: string;
	workdir: string;
	language?: string;
	dockerfile?: string;
	port?: number;
	env_vars?: Record<string, string>;
	depends_on?: string[];
	build_context?: string;
}

export interface MultiServiceConfig {
	isMultiService: boolean;
	services: ServiceDefinition[];
	hasDockerCompose: boolean;
}

/**
 * Detects if a docker-compose.yml file exists and parses it
 */
export function detectDockerCompose(appDir: string): MultiServiceConfig | null {
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
				const compose = yaml.load(content) as any;

				if (compose && compose.services) {
					const services: ServiceDefinition[] = [];

					for (const [serviceName, serviceConfig] of Object.entries(compose.services as any)) {
						const config = serviceConfig as any;
						
						// Skip database services (we'll handle them separately)
						if (isDatabaseService(serviceName, config)) {
							continue;
						}

						const service: ServiceDefinition = {
							name: serviceName,
							workdir: config.build?.context || appDir,
							dockerfile: config.build?.dockerfile || (fs.existsSync(path.join(appDir, `Dockerfile.${serviceName}`)) ? `Dockerfile.${serviceName}` : undefined),
							port: extractPort(config),
							env_vars: config.environment || {},
							depends_on: config.depends_on || [],
							build_context: config.build?.context || appDir
						};

						// Detect language if no dockerfile specified
						if (!service.dockerfile && service.workdir) {
							service.language = detectLanguage(service.workdir);
						}

						services.push(service);
					}

					if (services.length > 0) {
						return {
							isMultiService: true,
							services,
							hasDockerCompose: true
						};
					}
				}
			} catch (error) {
				console.error(`Error parsing docker-compose file: ${error}`);
			}
		}
	}

	return null;
}

/**
 * Algorithmically detects multiple services by looking for common patterns
 */
export function detectMultiServicePatterns(appDir: string): MultiServiceConfig | null {
	const services: ServiceDefinition[] = [];
	const commonServiceDirs = [
		"ui", "frontend", "web", "client",
		"api", "backend", "server",
		"app", "service"
	];

	// Check for multiple service directories
	const foundDirs: string[] = [];
	for (const dir of commonServiceDirs) {
		const dirPath = path.join(appDir, dir);
		if (fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory()) {
			foundDirs.push(dir);
		}
	}

	// If we found multiple service directories, treat as multi-service
	if (foundDirs.length > 1) {
		for (const dir of foundDirs) {
			const serviceDir = path.join(appDir, dir);
			const language = detectLanguage(serviceDir);
			
			if (language) {
				services.push({
					name: dir,
					workdir: serviceDir,
					language,
					port: getDefaultPort(language)
				});
			}
		}

		if (services.length > 1) {
			return {
				isMultiService: true,
				services,
				hasDockerCompose: false
			};
		}
	}

	// Check for multiple Dockerfiles
	const dockerfiles = findDockerfiles(appDir);
		if (dockerfiles.length > 1) {
			for (const dockerfile of dockerfiles) {
				const serviceName = extractServiceNameFromDockerfile(dockerfile);
				const dockerfileDir = path.dirname(dockerfile);
				const language = detectLanguage(dockerfileDir);

				if (language) {
					services.push({
						name: serviceName,
						workdir: dockerfileDir,
						language,
						dockerfile: path.basename(dockerfile),
						port: getDefaultPort(language)
					});
				}
			}

		if (services.length > 1) {
			return {
				isMultiService: true,
				services,
				hasDockerCompose: false
			};
		}
	}

	return null;
}

/**
 * Detects the programming language of a directory
 */
function detectLanguage(dir: string): string | undefined {
	if (fs.existsSync(path.join(dir, "package.json"))) return "node";
	if (fs.existsSync(path.join(dir, "requirements.txt"))) return "python";
	if (fs.existsSync(path.join(dir, "go.mod"))) return "go";
	if (fs.existsSync(path.join(dir, "pom.xml")) || fs.existsSync(path.join(dir, "build.gradle"))) return "java";
	if (fs.existsSync(path.join(dir, "Cargo.toml"))) return "rust";
	// Check for .NET projects
	if (globMatch(dir, "*.csproj") || globMatch(dir, "*.sln")) return "dotnet";
	if (fs.existsSync(path.join(dir, "composer.json"))) return "php";
	return undefined;
}

/**
 * Finds all Dockerfiles in a directory
 */
function findDockerfiles(dir: string): string[] {
	const dockerfiles: string[] = [];
	
	function search(currentDir: string, depth: number = 0) {
		if (depth > 3) return; // Limit search depth

		try {
			const entries = fs.readdirSync(currentDir);
			
			for (const entry of entries) {
				const fullPath = path.join(currentDir, entry);
				const stat = fs.statSync(fullPath);

				if (stat.isDirectory() && !entry.startsWith(".") && entry !== "node_modules") {
					search(fullPath, depth + 1);
				} else if (entry === "Dockerfile" || entry.startsWith("Dockerfile.")) {
					dockerfiles.push(fullPath);
				}
			}
		} catch (error) {
			// Ignore permission errors
		}
	}

	search(dir);
	return dockerfiles;
}

/**
 * Extracts service name from Dockerfile path
 */
function extractServiceNameFromDockerfile(dockerfilePath: string): string {
	const basename = path.basename(dockerfilePath);
	if (basename.startsWith("Dockerfile.")) {
		return basename.replace("Dockerfile.", "");
	}
	const dirname = path.basename(path.dirname(dockerfilePath));
	return dirname || "app";
}

/**
 * Checks if a service is a database service
 */
function isDatabaseService(serviceName: string, config: any): boolean {
	const dbKeywords = ["db", "database", "postgres", "mysql", "mssql", "mongodb", "redis", "sqlite"];
	const image = config.image || "";
	const serviceLower = serviceName.toLowerCase();
	
	return dbKeywords.some(keyword => 
		serviceLower.includes(keyword) || image.toLowerCase().includes(keyword)
	);
}

/**
 * Extracts port from docker-compose service config
 */
function extractPort(config: any): number | undefined {
	if (config.ports && Array.isArray(config.ports)) {
		const portMapping = config.ports[0];
		if (typeof portMapping === "string") {
			const match = portMapping.match(/:(\d+)/);
			return match ? parseInt(match[1]) : undefined;
		}
	}
	return undefined;
}

/**
 * Gets default port for a language
 */
function getDefaultPort(language: string): number {
	const portMap: Record<string, number> = {
		node: 3000,
		python: 8000,
		go: 8080,
		java: 8080,
		rust: 8080,
		dotnet: 5000,
		php: 8000
	};
	return portMap[language] || 8080;
}

/**
 * Simple glob matching helper
 */
function globMatch(dir: string, pattern: string): boolean {
	try {
		const files = fs.readdirSync(dir);
		const regex = new RegExp(pattern.replace("*", ".*"));
		return files.some(file => regex.test(file));
	} catch {
		return false;
	}
}

/**
 * Main function to detect multi-service configuration
 */
export function detectMultiService(appDir: string): MultiServiceConfig {
	// First, try docker-compose
	const composeConfig = detectDockerCompose(appDir);
	if (composeConfig) {
		return composeConfig;
	}

	// Then, try algorithmic detection
	const patternConfig = detectMultiServicePatterns(appDir);
	if (patternConfig) {
		return patternConfig;
	}

	// Single service
	return {
		isMultiService: false,
		services: [],
		hasDockerCompose: false
	};
}
