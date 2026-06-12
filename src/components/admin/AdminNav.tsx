"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, ClipboardList, ServerCog, Users } from "lucide-react";
import { cn } from "@/lib/utils";

const adminLinks = [
	{ href: "/admin/users", label: "Users", icon: Users },
	{ href: "/admin/deployments", label: "Deployments", icon: Activity },
	{ href: "/admin/reports", label: "Reports", icon: ClipboardList },
	{ href: "/admin/system", label: "System", icon: ServerCog },
];

export function AdminNav() {
	const pathname = usePathname();

	return (
		<nav className="flex gap-2 overflow-x-auto md:flex-col md:overflow-visible">
			{adminLinks.map((item) => {
				const Icon = item.icon;
				const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
				return (
					<Link
						key={item.href}
						href={item.href}
						className={cn(
							"flex h-10 shrink-0 items-center gap-2 rounded-md px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground",
							active && "bg-primary/15 text-primary ring-1 ring-primary/20"
						)}
					>
						<Icon className="size-4" />
						<span>{item.label}</span>
					</Link>
				);
			})}
		</nav>
	);
}
