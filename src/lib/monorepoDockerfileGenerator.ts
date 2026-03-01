import fs from "fs";
import path from "path";
import { ServiceDefinition, MultiServiceConfig } from "./multiServiceDetector";

/**
 * Generates a proper Dockerfile for a monorepo service.
 * 
 * Monorepo services need special handling:
 * 1. The build context must be the monorepo root (so shared packages are available)
 * 2. The Dockerfile must COPY the full workspace and install from the root
 * 3. Build/run commands target the specific service using the workspace package manager
 */
export function generateMonorepoDockerfile(
	service: ServiceDefinition,
	multiServiceConfig: MultiServiceConfig,
	monorepoRoot: string,
): string {
	const language = service.language || "node";
	const framework = service.framework;
	const relativePath = service.relativePath || path.relative(monorepoRoot, service.workdir).replace(/\\/g, "/");
	const pm = multiServiceConfig.packageManager || "npm";
	const port = service.port || 8080;

	// Read package.json of the service to get the package name and scripts
	let packageName = `@monorepo/${service.name}`;
	let hasStartScript = false;
	let hasBuildScript = false;
	const serviceDir = path.isAbsolute(service.workdir) ? service.workdir : path.join(monorepoRoot, service.workdir);
	const pkgPath = path.join(serviceDir, "package.json");
	if (fs.existsSync(pkgPath)) {
		try {
			const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
			packageName = pkg.name || packageName;
			hasStartScript = !!pkg.scripts?.start;
			hasBuildScript = !!pkg.scripts?.build;
		} catch { /* ignore */ }
	}

	switch (language) {
		case "node":
			return generateNodeMonorepoDockerfile(pm, relativePath, packageName, port, framework, hasStartScript, hasBuildScript);
		case "python":
			return generatePythonMonorepoDockerfile(relativePath, port);
		case "go":
			return generateGoMonorepoDockerfile(relativePath, port);
		default:
			return generateNodeMonorepoDockerfile(pm, relativePath, packageName, port, framework, hasStartScript, hasBuildScript);
	}
}

function generateNodeMonorepoDockerfile(
	pm: string,
	relativePath: string,
	packageName: string,
	port: number,
	framework?: string,
	hasStartScript: boolean = true,
	hasBuildScript: boolean = false,
): string {
	const installCmd = pm === "pnpm"
		? "RUN corepack enable && corepack prepare pnpm@latest --activate && pnpm install --frozen-lockfile"
		: pm === "yarn"
			? "RUN yarn install --frozen-lockfile"
			: "RUN npm ci";

	const lockfiles = pm === "pnpm"
		? "COPY pnpm-lock.yaml pnpm-workspace.yaml ./"
		: pm === "yarn"
			? "COPY yarn.lock ./"
			: "COPY package-lock.json ./";

	// For pnpm, we need to filter the install to be more efficient
	const buildCmd = hasBuildScript
		? pm === "pnpm"
			? `RUN pnpm --filter ${packageName} build`
			: pm === "yarn"
				? `RUN yarn workspace ${packageName} build`
				: `RUN npm run build --workspace=${relativePath}`
		: "";

	const startCmd = pm === "pnpm"
		? `CMD ["pnpm", "--filter", "${packageName}", "start"]`
		: pm === "yarn"
			? `CMD ["yarn", "workspace", "${packageName}", "start"]`
			: `CMD ["npm", "run", "start", "--workspace=${relativePath}"]`;

	// Next.js requires standalone output for optimal Docker builds
	const nextjsNote = framework === "nextjs"
		? `# Note: For production Next.js, consider adding output: 'standalone' to next.config.js`
		: "";

	return `
FROM node:20-alpine AS base
WORKDIR /app

# Copy package files for dependency caching
COPY package.json ./
${lockfiles}

# Copy all workspace package.json files so install can resolve workspace deps
COPY ${relativePath}/package.json ./${relativePath}/package.json
# Copy other workspace packages that this service may depend on
COPY packages/ ./packages/ 2>/dev/null || true

${installCmd}

# Copy full monorepo source
COPY . .

${nextjsNote}
${buildCmd}

ENV PORT=${port}
EXPOSE ${port}

${startCmd}
`.trim();
}

function generatePythonMonorepoDockerfile(relativePath: string, port: number): string {
	return `
FROM python:3.11-slim
WORKDIR /app

# Copy the full monorepo
COPY . .

# Install dependencies for this service
RUN pip install --no-cache-dir -r ${relativePath}/requirements.txt

WORKDIR /app/${relativePath}

ENV PORT=${port}
EXPOSE ${port}

CMD ["python", "app.py"]
`.trim();
}

function generateGoMonorepoDockerfile(relativePath: string, port: number): string {
	return `
FROM golang:1.21-alpine AS builder
WORKDIR /app

# Copy the full monorepo (Go modules may reference local packages)
COPY . .

WORKDIR /app/${relativePath}
RUN go mod download
RUN CGO_ENABLED=0 go build -o /app/main .

FROM alpine:latest
WORKDIR /app
RUN apk --no-cache add ca-certificates
COPY --from=builder /app/main .

ENV PORT=${port}
EXPOSE ${port}

CMD ["./main"]
`.trim();
}

/**
 * Generates a docker-compose.yml for a monorepo with multiple deployable services.
 * Each service gets its own Dockerfile with the build context set to the monorepo root.
 */
export function generateMonorepoDockerCompose(
	services: ServiceDefinition[],
	multiServiceConfig: MultiServiceConfig,
	monorepoRoot: string,
	envVars?: string,
	dbConnectionString?: string,
): string {
	const composeServices: Record<string, any> = {};

	for (const service of services) {
		const relativePath = service.relativePath || path.relative(monorepoRoot, service.workdir).replace(/\\/g, "/");
		const p = service.port || 8080;
		const env: string[] = [`PORT=${p}`, "NODE_ENV=production"];
		if (dbConnectionString) env.push(`DATABASE_URL=${dbConnectionString}`);

		// Add inter-service communication URLs
		for (const otherService of services) {
			if (otherService.name !== service.name) {
				const envKey = `${otherService.name.toUpperCase().replace(/-/g, "_")}_URL`;
				env.push(`${envKey}=http://${otherService.name}:${otherService.port || 8080}`);
			}
		}

		composeServices[service.name] = {
			build: {
				context: ".",
				dockerfile: `Dockerfile.${service.name}`,
			},
			ports: [`${p}:${p}`],
			environment: env,
			restart: "unless-stopped",
		};
	}

	return JSON.stringify({ version: "3.8", services: composeServices }, null, 2);
}

/**
 * Writes Dockerfiles for all monorepo services.
 * Creates Dockerfile.<service-name> files at the monorepo root.
 */
export function writeMonorepoDockerfiles(
	services: ServiceDefinition[],
	multiServiceConfig: MultiServiceConfig,
	monorepoRoot: string,
): void {
	for (const service of services) {
		const dockerfileName = `Dockerfile.${service.name}`;
		const dockerfilePath = path.join(monorepoRoot, dockerfileName);

		// Don't overwrite existing Dockerfiles
		if (fs.existsSync(dockerfilePath)) {
			console.log(`Dockerfile already exists: ${dockerfileName}`);
			continue;
		}

		// Also check if the service has its own Dockerfile
		const serviceDockerfile = path.join(
			path.isAbsolute(service.workdir) ? service.workdir : path.join(monorepoRoot, service.workdir),
			"Dockerfile"
		);
		if (fs.existsSync(serviceDockerfile)) {
			console.log(`Service ${service.name} has its own Dockerfile, skipping generation`);
			service.dockerfile = "Dockerfile";
			continue;
		}

		const content = generateMonorepoDockerfile(service, multiServiceConfig, monorepoRoot);
		fs.writeFileSync(dockerfilePath, content);
		service.dockerfile = dockerfileName;
		console.log(`Generated ${dockerfileName} for service ${service.name}`);
	}
}
