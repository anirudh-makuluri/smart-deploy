import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
	sessionOptions: {
		refetchOnWindowFocus: false,
	},
	fetchOptions: {
		retry: 0,
	},
});

