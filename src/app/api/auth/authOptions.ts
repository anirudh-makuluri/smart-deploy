import config from "@/config";
import { AuthOptions } from "next-auth"
import GitHubProvider from 'next-auth/providers/github'

export const authOptions : AuthOptions = {
	providers: [
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
