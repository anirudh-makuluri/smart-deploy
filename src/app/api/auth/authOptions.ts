import config from "@/config";
import { AuthOptions } from "next-auth"
import GitHubProvider from 'next-auth/providers/github'
import GoogleProvider from 'next-auth/providers/google'

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
				params : {
					scope: "read:user repo"
				}
			}
		})
	],
	callbacks: {
		async signIn({ user, account, profile }) {
			// In production, only allow emails containing "anirudh"
			if (process.env.ENVIRONMENT === 'production') {
				const email = user.email || profile?.email || '';
				if (!email.toLowerCase().includes('anirudh')) {
					// Deny sign in - will redirect to error page
					return false;
				}
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
