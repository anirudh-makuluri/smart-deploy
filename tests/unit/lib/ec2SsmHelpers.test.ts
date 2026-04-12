import { describe, expect, it } from "vitest";
import {
	buildFirstDeployScript,
	buildRedeployScript,
	generateEcrUserDataScript,
} from "@/lib/aws/ec2SsmHelpers";

describe("ec2SsmHelpers", () => {
	it("uses docker-compose only when scan_results includes docker_compose", () => {
		const script = buildFirstDeployScript({
			envFileContentBase64: "",
			dockerCompose: [
				"services:",
				"  app:",
				"    build:",
				"      context: .",
				"      dockerfile: Dockerfile",
			].join("\n"),
			dockerfiles: { Dockerfile: "FROM node:20" },
			mainPort: "3000",
			scanServices: [{ dockerfile_path: "Dockerfile", build_context: "." }],
		});

		expect(script).toContain('if [ ! -f docker-compose.yml ]; then');
		expect(script).toContain('docker-compose up -d --build');
		expect(script).not.toContain('if [ -f docker-compose.yml ] || [ -f docker-compose.yaml ]');
	});

	it("does not fall back to repo compose files when scan_results lacks docker_compose", () => {
		const script = buildRedeployScript({
			repoUrl: "https://github.com/example/repo.git",
			branch: "main",
			token: "token",
			envFileContentBase64: "",
			dockerCompose: "",
			dockerfiles: { Dockerfile: "FROM node:20" },
			mainPort: "3000",
			scanServices: [{ dockerfile_path: "Dockerfile", build_context: "." }],
		});

		expect(script).toContain('docker build -f \'Dockerfile\' -t smartdeploy-app \'.\'');
		expect(script).not.toContain('docker-compose up -d --build');
		expect(script).not.toContain('if [ -f docker-compose.yml ] || [ -f docker-compose.yaml ]');
	});

	it("adds websocket proxying to the ECR user-data nginx config when scan_results include a websocket service port", () => {
		const script = generateEcrUserDataScript("3000", "4001");

		expect(script).toContain("location /ws");
		expect(script).toContain("proxy_pass http://127.0.0.1:4001;");
	});
});
