"use client";

import Link from "next/link";
import { Layers } from "lucide-react";

type Props = {
	/** If set, wrap in Link to this href; otherwise render a fragment */
	href?: string;
	/** Size of the icon box (default 8 = 32px) */
	size?: "sm" | "md" | "lg";
	/** Show "Smart Deploy" text next to icon */
	showText?: boolean;
	className?: string;
};

const sizeMap = { sm: "size-6", md: "size-8", lg: "size-10" };
const iconMap = { sm: "size-3", md: "size-4", lg: "size-5" };

export function SmartDeployLogo({ href, size = "md", showText = true, className = "" }: Props) {
	const box = sizeMap[size];
	const icon = iconMap[size];

	const content = (
		<>
			<div className={`landing-build-blue flex ${box} items-center justify-center rounded-lg flex-shrink-0`}>
				<Layers className={`${icon} text-white`} />
			</div>
			{showText && <span className="font-semibold text-lg tracking-tight">Smart Deploy</span>}
		</>
	);

	if (href) {
		return (
			<Link href={href} className={`flex items-center gap-2 text-[#e2e8f0] hover:opacity-90 transition-opacity ${className}`}>
				{content}
			</Link>
		);
	}

	return <div className={`flex items-center gap-2 text-[#e2e8f0] ${className}`}>{content}</div>;
}
