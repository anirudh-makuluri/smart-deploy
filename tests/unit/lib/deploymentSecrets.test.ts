import { describe, expect, it } from "vitest";
import {
	buildDeploymentSecretName,
	buildEcsContainerSecrets,
	ecsSecretReference,
	envEntriesToSecretObject,
	secretObjectToEntries,
} from "@/lib/aws/deploymentSecrets";

describe("deploymentSecrets helpers", () => {
	it("builds stable secret names from deployment identity", () => {
		expect(buildDeploymentSecretName("user-1", "acme/web", "api")).toBe(
			"smartdeploy/user-1/acme-web/api"
		);
	});

	it("round-trips env entries through a secret object", () => {
		const entries = [
			{ name: "API_KEY", value: "secret" },
			{ name: "PORT", value: "3000" },
		];
		expect(secretObjectToEntries(envEntriesToSecretObject(entries))).toEqual(entries);
	});

	it("builds ECS secret references for JSON keys", () => {
		const arn = "arn:aws:secretsmanager:us-west-2:123456789012:secret:smartdeploy/user/repo/service-AbCdEf";
		expect(ecsSecretReference(arn, "DATABASE_URL")).toBe(`${arn}:DATABASE_URL::`);
		expect(buildEcsContainerSecrets(arn, ["DATABASE_URL", "API_KEY"])).toEqual([
			{ name: "DATABASE_URL", valueFrom: `${arn}:DATABASE_URL::` },
			{ name: "API_KEY", valueFrom: `${arn}:API_KEY::` },
		]);
	});
});
