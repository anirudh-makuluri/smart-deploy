"use client";

import { useSession, signIn, signOut } from "next-auth/react";

export default function AuthButton() {
	const { data: session } = useSession();

	if (session) {
		
		return (
			<div className="p-4">
				Signed in as {session.user?.name} with {session.accessToken}
				<button onClick={() => signOut()} className="ml-4 bg-red-500 px-3 py-1 rounded text-white">
					Log out
				</button>
			</div>
		);
	}

	return (
		<button onClick={() => signIn("github")} className="bg-black text-white px-4 py-2 rounded">
			Sign in with GitHub
		</button>
	);
}
