"use client";

import { Button } from "./ui/button";
import { signOut } from "next-auth/react";
import Link from "next/link";
import { SmartDeployLogo } from "./SmartDeployLogo";

export default function Header() {
	return (
		<header className="shrink-0 w-full border-b border-border bg-background/90">
			<div className="px-6 py-3 flex flex-row justify-between items-center">
				<SmartDeployLogo href="/" showText size="md" />
				<div className="flex flex-row gap-3 items-center">
					<Button variant="destructive" onClick={() => signOut()}>
						Sign out
					</Button>
				</div>
			</div>
		</header>
	);
}
