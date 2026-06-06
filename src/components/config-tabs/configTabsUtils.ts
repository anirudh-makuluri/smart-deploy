import { z } from "zod";
import config from "@/config.client";
import type { DeployConfig } from "@/app/types";

export const DOMAIN_SUFFIX = config.NEXT_PUBLIC_DEPLOYMENT_DOMAIN || "smart-deploy.xyz";

export const formSchema = z.object({
	branch: z.string().min(1, { message: "Branch is required" }),
	envVars: z.string().optional(),
	liveUrl: z.string().optional(),
});

export type FormSchemaType = z.infer<typeof formSchema>;

export function mapCustomDomainError(error: unknown): string {
	const message = error instanceof Error ? error.message : "Failed to update custom domain";
	if (message === "Deployment not found") {
		return "This deployment no longer exists. Reopen the service or deploy again before setting a custom domain.";
	}
	return message;
}

export function getCustomUrlFromSubdomain(subdomain: string): string {
	return subdomain ? `https://${subdomain}.${DOMAIN_SUFFIX}` : "";
}

export function getInitialSubdomain(deployment: DeployConfig): string {
	let raw = deployment.liveUrl;
	if (!raw) return "";
	raw = raw.replace(/^https?:\/\//, "");
	if (raw.endsWith(`.${DOMAIN_SUFFIX}`)) {
		return raw.slice(0, -(DOMAIN_SUFFIX.length + 1));
	}
	return raw.split(".")[0];
}
