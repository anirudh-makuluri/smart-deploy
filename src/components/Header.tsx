"use client";

import { Button } from "./ui/button";
import { signOut } from "next-auth/react";
import Link from "next/link";
import { SmartDeployLogo } from "./SmartDeployLogo";

export default function Header() {
	return (
		<header className="flex-shrink-0 w-full border-b border-[#1e3a5f]/60">
			<div className="px-6 py-3 flex flex-row justify-between items-center">
				<SmartDeployLogo href="/" showText size="md" />
				<div className="flex flex-row gap-3 items-center">
					<Button
						variant="outline"
						asChild
						className="border-[#1e3a5f] bg-transparent text-[#e2e8f0] hover:bg-[#1e3a5f]/50 hover:text-[#e2e8f0]"
					>
						<Link href="/">Dashboard</Link>
					</Button>
					<Button
						onClick={() => signOut()}
						className="bg-[#dc2626]/90 hover:bg-[#dc2626] text-white border-0"
					>
						Sign out
					</Button>
				</div>
			</div>
		</header>
	);
}
