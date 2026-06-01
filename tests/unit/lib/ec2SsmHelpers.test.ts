import { describe, expect, it } from "vitest";
import {
	buildFirstDeployScript,
	buildEcrComposeDeployScript,
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

		expect(script).toContain('if [ -f docker-compose.yml ] || [ -f docker-compose.yaml ]');
		expect(script).toContain('docker-compose up -d --build');
		expect(script).not.toContain('Deploying from scan_results (single service, no compose from scan)');
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

	it("embeds custom nginx.conf from scan_results in ECR user-data (e.g. websocket /ws proxy)", () => {
		const nginxFromScan = `server {
  listen 80;
  location /ws {
    proxy_pass http://127.0.0.1:4001;
  }
  location / {
    proxy_pass http://127.0.0.1:3000;
  }
}`;
		const script = generateEcrUserDataScript("3000", nginxFromScan);

		expect(script).toContain("location /ws");
		expect(script).toContain("proxy_pass http://127.0.0.1:4001;");
	});

	it("uses explicit stored image refs for ECR compose deployments", () => {
		const script = buildEcrComposeDeployScript({
			ecrRegistry: "123.dkr.ecr.us-west-2.amazonaws.com",
			ecrRepoName: "smartdeploy/shop",
			imageTag: "abcdef",
			region: "us-west-2",
			envFileContentBase64: "",
			composeContent: [
				"services:",
				"  api:",
				"    build:",
				"      context: ./api",
				"  web:",
				"    build:",
				"      context: ./web",
			].join("\n"),
			services: [
				{ name: "api", port: 4000 },
				{ name: "web", port: 3000 },
			],
			serviceImageRefs: [
				{ serviceName: "api", imageUri: "123.dkr.ecr.us-west-2.amazonaws.com/smartdeploy/shop-api@sha256:aaa" },
				{ serviceName: "web", imageUri: "123.dkr.ecr.us-west-2.amazonaws.com/smartdeploy/shop-web@sha256:bbb" },
			],
			ecrPasswordB64: "cGFzcw==",
		});

		const composeB64 = script.match(/echo '([^']+)' \| base64 -d > docker-compose.yml/)?.[1] ?? "";
		const compose = Buffer.from(composeB64, "base64").toString("utf8");

		expect(compose).toContain("image: 123.dkr.ecr.us-west-2.amazonaws.com/smartdeploy/shop-api@sha256:aaa");
		expect(compose).toContain("image: 123.dkr.ecr.us-west-2.amazonaws.com/smartdeploy/shop-web@sha256:bbb");
	});
});
