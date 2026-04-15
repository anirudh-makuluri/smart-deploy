import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { getDbPool } from "@/lib/dbPool";

function env(name: string): string {
	return (process.env[name] || "").trim();
}

function hasOAuth(provider: "google" | "github") {
	if (provider === "google") return Boolean(env("GOOGLE_CLIENT_ID") && env("GOOGLE_CLIENT_SECRET"));
	return Boolean(env("GITHUB_ID") && env("GITHUB_SECRET"));
}

export const auth = betterAuth({
	// In unit tests / build-time environments we may not have DATABASE_URL.
	// Better Auth supports stateless mode when no database is configured.
	database: env("DATABASE_URL") ? getDbPool() : undefined,
	secret: env("BETTER_AUTH_SECRET"),
	baseURL: env("BETTER_AUTH_URL"),
	emailAndPassword: {
		enabled: true,
	},
	socialProviders: {
		...(hasOAuth("google")
			? {
					google: {
						clientId: env("GOOGLE_CLIENT_ID"),
						clientSecret: env("GOOGLE_CLIENT_SECRET"),
					},
			  }
			: {}),
		...(hasOAuth("github")
			? {
					github: {
						clientId: env("GITHUB_ID"),
						clientSecret: env("GITHUB_SECRET"),
					},
			  }
			: {}),
	},
	account: {
		encryptOAuthTokens: true,
	},
	plugins: [nextCookies()],
});

