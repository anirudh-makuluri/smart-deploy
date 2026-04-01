import NextAuth, { DefaultSession } from "next-auth";

declare module "next-auth" {
	interface Session extends DefaultSession{
		accessToken?: string;
		userID?: string;
		accountMode?: "internal" | "demo";
	}

	interface User {
		accessToken?: string;
		userID?: string;
		accountMode?: "internal" | "demo";
	}
}

declare module "next-auth/jwt" {
	interface JWT {
		accessToken?: string;
		userID?: string;
		accountMode?: "internal" | "demo";
	}
}
