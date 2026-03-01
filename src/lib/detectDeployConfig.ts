import fs from "fs";
import path from "path";
import type { CoreDeploymentInfo } from "@/app/types";

export type DetectDeployConfigOptions = {
	language?: string;
	framework?: string;
	/** Relative workdir from repo root (e.g. "apps/web") for display. */
	relativeWorkdir?: string | null;
};

const DEFAULT_PORT: Record<string, number> = {
	node: 3000,
	python: 8000,
	go: 8080,
	java: 8080,
	rust: 8080,
	dotnet: 5000,
	php: 8000,
};

function defaultPort(language: string): number {
	return DEFAULT_PORT[language] ?? 8080;
}

/**
 * Rule-based detection of deploy config from a service directory.
 * Reads package.json, requirements.txt, go.mod, etc. to infer install_cmd, build_cmd, run_cmd, workdir, port.
 */
export function detectDeployConfig(
	serviceDir: string,
	options: DetectDeployConfigOptions = {}
): CoreDeploymentInfo {
	const { language: hintLanguage, framework: hintFramework, relativeWorkdir } = options;
	const workdir = relativeWorkdir ?? ".";

	// Node / JavaScript / TypeScript
	const pkgPath = path.join(serviceDir, "package.json");
	if (fs.existsSync(pkgPath)) {
		return detectNodeConfig(serviceDir, pkgPath, workdir, hintFramework);
	}

	// Python
	const reqPath = path.join(serviceDir, "requirements.txt");
	if (fs.existsSync(reqPath)) {
		return detectPythonConfig(serviceDir, reqPath, workdir);
	}

	// Go
	if (fs.existsSync(path.join(serviceDir, "go.mod"))) {
		return {
			language: "go",
			framework: "",
			install_cmd: "go mod download",
			build_cmd: "go build -o app .",
			run_cmd: "./app",
			workdir,
			port: defaultPort("go"),
		};
	}

	// Java (Maven)
	if (fs.existsSync(path.join(serviceDir, "pom.xml"))) {
		return {
			language: "java",
			framework: "",
			install_cmd: "mvn dependency:go-offline -B",
			build_cmd: "mvn package -DskipTests -B",
			run_cmd: "java -jar target/*.jar",
			workdir,
			port: defaultPort("java"),
		};
	}

	// Rust
	if (fs.existsSync(path.join(serviceDir, "Cargo.toml"))) {
		return {
			language: "rust",
			framework: "",
			install_cmd: "cargo fetch",
			build_cmd: "cargo build --release",
			run_cmd: "./target/release/app",
			workdir,
			port: defaultPort("rust"),
		};
	}

	// .NET
	const csproj = fs.readdirSync(serviceDir).find((f) => f.endsWith(".csproj"));
	if (csproj) {
		const name = path.basename(csproj, ".csproj");
		return {
			language: "dotnet",
			framework: "",
			install_cmd: "dotnet restore",
			build_cmd: "dotnet publish -c Release -o out",
			run_cmd: `dotnet out/${name}.dll`,
			workdir,
			port: defaultPort("dotnet"),
		};
	}

	// PHP
	if (fs.existsSync(path.join(serviceDir, "composer.json"))) {
		return {
			language: "php",
			framework: "",
			install_cmd: "composer install --no-dev --optimize-autoloader",
			build_cmd: "",
			run_cmd: "php -S 0.0.0.0:8000 -t public",
			workdir,
			port: defaultPort("php"),
		};
	}

	// Fallback
	return {
		language: hintLanguage ?? "node",
		framework: hintFramework ?? "",
		install_cmd: "npm install",
		build_cmd: "npm run build || true",
		run_cmd: "npm start",
		workdir,
		port: hintLanguage ? defaultPort(hintLanguage) : 8080,
	};
}

function detectNodeConfig(
	serviceDir: string,
	pkgPath: string,
	workdir: string,
	hintFramework?: string
): CoreDeploymentInfo {
	let language = "node";
	let framework = hintFramework ?? "";
	let install_cmd = "npm install";
	let build_cmd = "";
	let run_cmd = "npm start";

	try {
		const raw = fs.readFileSync(pkgPath, "utf-8");
		const pkg = JSON.parse(raw) as Record<string, unknown>;
		const scripts = (pkg.scripts as Record<string, string>) ?? {};
		const deps = { ...(pkg.dependencies as Record<string, string>), ...(pkg.devDependencies as Record<string, string>) };

		// Package manager from root or lockfile
		const hasPnpm = fs.existsSync(path.join(serviceDir, "pnpm-lock.yaml"));
		const hasYarn = fs.existsSync(path.join(serviceDir, "yarn.lock"));
		if (hasPnpm) {
			install_cmd = "pnpm install --frozen-lockfile";
		} else if (hasYarn) {
			install_cmd = "yarn install --frozen-lockfile";
		}

		// Framework from dependencies
		if (deps["next"]) framework = "nextjs";
		else if (deps["express"]) framework = "express";
		else if (deps["fastify"]) framework = "fastify";
		else if (deps["@nestjs/core"]) framework = "nestjs";
		else if (deps["nuxt"]) framework = "nuxt";
		else if (deps["react"]) framework = "react";
		else if (deps["vue"]) framework = "vue";
		else if (deps["@angular/core"]) framework = "angular";
		else if (deps["svelte"]) framework = "svelte";

		// Build: prefer scripts.build, then framework defaults
		if (scripts.build) {
			build_cmd = hasPnpm ? "pnpm run build" : hasYarn ? "yarn build" : "npm run build";
		} else if (framework === "nextjs") {
			build_cmd = hasPnpm ? "pnpm run build" : hasYarn ? "yarn build" : "npm run build";
		} else {
			build_cmd = "npm run build || true";
		}

		// Run: prefer scripts.start, then dev, then serve
		if (scripts.start) {
			run_cmd = hasPnpm ? "pnpm start" : hasYarn ? "yarn start" : "npm start";
		} else if (scripts.dev) {
			run_cmd = hasPnpm ? "pnpm run dev" : hasYarn ? "yarn dev" : "npm run dev";
		} else if (scripts.serve) {
			run_cmd = hasPnpm ? "pnpm run serve" : hasYarn ? "yarn serve" : "npm run serve";
		}
	} catch {
		// use defaults
	}

	const port = framework === "nextjs" ? 3000 : defaultPort(language);
	return {
		language,
		framework,
		install_cmd,
		build_cmd: build_cmd || "npm run build || true",
		run_cmd,
		workdir,
		port,
	};
}

function detectPythonConfig(serviceDir: string, reqPath: string, workdir: string): CoreDeploymentInfo {
	let framework = "";
	let run_cmd = "python main.py";
	try {
		const reqs = fs.readFileSync(reqPath, "utf-8");
		if (reqs.includes("django")) {
			framework = "django";
			run_cmd = "gunicorn project.wsgi:application --bind 0.0.0.0:8000";
		} else if (reqs.includes("flask")) {
			framework = "flask";
			run_cmd = "gunicorn app:app --bind 0.0.0.0:8000";
		} else if (reqs.includes("fastapi") || reqs.includes("uvicorn")) {
			framework = "fastapi";
			run_cmd = "uvicorn main:app --host 0.0.0.0 --port 8000";
		}
	} catch {
		// use defaults
	}
	return {
		language: "python",
		framework,
		install_cmd: "pip install -r requirements.txt",
		build_cmd: "",
		run_cmd,
		workdir,
		port: defaultPort("python"),
	};
}
