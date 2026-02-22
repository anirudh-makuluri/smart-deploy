import config from "../../../config";
import { AuthOptions } from "next-auth"
import GitHubProvider from 'next-auth/providers/github'
import GoogleProvider from 'next-auth/providers/google'
import { dbHelper } from "@/db-helper"

export const authOptions : AuthOptions = {
	providers: [
		GoogleProvider({
			clientId: process.env.GOOGLE_CLIENT_ID ?? "",
			clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
		}),
		GitHubProvider({
			clientId: config.GITHUB_ID,
			clientSecret: config.GITHUB_SECRET,
			authorization: {
				params: {
					scope: "read:user user:email repo",
				},
			},
		}),
	],
	callbacks: {
		async signIn({ user, account, profile }) {
			const email = user.email || (profile as { email?: string })?.email || "";
			const name = user.name || (profile as { name?: string })?.name || "";
			if (!email.toLowerCase().includes("anirudh")) {
				// Store in waiting list and deny sign-in (redirects to waiting-list page)
				await dbHelper.addToWaitingList(email, name || undefined);
				return false;
			}
			return true;
		},

		async redirect({ url, baseUrl }) {
			// Allow relative callback URLs
			if (url.startsWith("/")) return `${baseUrl}${url}`;
			// Allow callback URLs on the same origin
			if (new URL(url).origin === baseUrl) return url;
			return baseUrl;
		},

		async jwt({ token, account, user }) {
			if(account && user) {
				console.log("GitHub access token:", account.access_token);
				token.accessToken = account.access_token
				token.userID = user.id;
			}

			return token
		},

		async session({ session, token }) {
			session.accessToken = token.accessToken as string;
			session.userID = token.userID;
			return session
		}
	},
	secret: process.env.NEXTAUTH_SECRET
}
