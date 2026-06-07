import { z } from "zod";
import config from "@/config.client";
import { hostedUrlFromSubdomain, normalizeHostedSubdomain } from "@/lib/hostedUrl";
import type { DeployConfig } from "@/app/types";

export const DOMAIN_SUFFIX = config.NEXT_PUBLIC_DEPLOYMENT_DOMAIN || "smart-deploy.xyz";

export const formSchema = z.object({
	branch: z.string().min(1, { message: "Branch is required" }),
	envVars: z.string().optional(),
	hostedSubdomain: z.string().optional(),
});

export type FormSchemaType = z.infer<typeof formSchema>;

export function mapCustomDomainError(error: unknown): string {
	const message = error instanceof Error ? error.message : "Failed to update custom domain";
	if (message === "Deployment not found") {
		return "This deployment no longer exists. Reopen the service or deploy again before setting a custom domain.";
	}
	return message;
}

export function getHostedUrlFromSubdomain(subdomain: string): string {
	return hostedUrlFromSubdomain(subdomain) ?? "";
}

export function savedHostedSubdomain(deployment: DeployConfig): string {
	return normalizeHostedSubdomain(deployment.hostedSubdomain);
}
