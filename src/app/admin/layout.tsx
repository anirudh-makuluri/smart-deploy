import type { Metadata } from "next";
import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { AdminNav } from "@/components/admin/AdminNav";
import { requireAdminSession } from "@/lib/admin";

export const metadata: Metadata = {
	title: "Admin",
	robots: {
		index: false,
		follow: false,
	},
};

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
	const user = await requireAdminSession();

	return (
		<div className="min-h-svh bg-background text-foreground">
			<header className="border-b border-white/10 bg-card/80 backdrop-blur">
				<div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-4 md:flex-row md:items-center md:justify-between lg:px-6">
					<Link href="/admin" className="flex items-center gap-3">
						<span className="flex size-10 items-center justify-center rounded-md border border-primary/25 bg-primary/10 text-primary">
							<ShieldCheck className="size-5" />
						</span>
						<span>
							<span className="block text-base font-semibold leading-tight">Smart Deploy Admin</span>
							<span className="block text-xs text-muted-foreground">{user.email}</span>
						</span>
					</Link>
					<Link href="/home" className="text-sm text-muted-foreground transition-colors hover:text-foreground">
						Back to workspace
					</Link>
				</div>
			</header>
			<div className="mx-auto grid max-w-7xl gap-5 px-4 py-5 md:grid-cols-[13rem_minmax(0,1fr)] lg:px-6">
				<aside className="md:sticky md:top-5 md:self-start">
					<AdminNav />
				</aside>
				<main className="min-w-0">{children}</main>
			</div>
		</div>
	);
}
