"use client";

import { Box, FileCode2, Globe, Rocket } from "lucide-react";
import type { DeploymentKind, StaticServiceType } from "@/app/types";

type ServiceTypeIconProps = {
	deployMode: DeploymentKind;
	serviceType?: StaticServiceType;
	className?: string;
};

const staticStyles: Record<StaticServiceType, { label: string; className: string }> = {
	vite: {
		label: "VI",
		className: "bg-[#646cff]/15 text-[#646cff] border-[#646cff]/25",
	},
	cra: {
		label: "CRA",
		className: "bg-[#61dafb]/15 text-[#2d9ec5] border-[#61dafb]/25",
	},
	vue: {
		label: "VUE",
		className: "bg-[#42b883]/15 text-[#42b883] border-[#42b883]/25",
	},
	angular: {
		label: "NG",
		className: "bg-[#dd0031]/15 text-[#dd0031] border-[#dd0031]/25",
	},
	svelte: {
		label: "SV",
		className: "bg-[#ff3e00]/15 text-[#ff3e00] border-[#ff3e00]/25",
	},
	astro: {
		label: "AS",
		className: "bg-[#ff5d01]/15 text-[#ff5d01] border-[#ff5d01]/25",
	},
	"next-export": {
		label: "NX",
		className: "bg-white/10 text-white border-white/15",
	},
	"static-html": {
		label: "HTML",
		className: "bg-[#e34f26]/15 text-[#e34f26] border-[#e34f26]/25",
	},
};

function formatServiceTypeLabel(serviceType?: StaticServiceType) {
	if (!serviceType) return "Static";
	if (serviceType === "next-export") return "Next Export";
	if (serviceType === "static-html") return "Static HTML";
	return serviceType.charAt(0).toUpperCase() + serviceType.slice(1);
}

export default function ServiceTypeIcon({ deployMode, serviceType, className = "" }: ServiceTypeIconProps) {
	if (deployMode === "container") {
		return (
			<div
				className={`flex size-8 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/[0.03] text-muted-foreground ${className}`.trim()}
				title="Container deployment"
				aria-label="Container deployment"
			>
				<Box className="size-4" aria-hidden="true" />
			</div>
		);
	}

	const style = serviceType ? staticStyles[serviceType] : null;
	if (!style) {
		return (
			<div
				className={`flex size-8 shrink-0 items-center justify-center rounded-lg border border-sky-500/20 bg-sky-500/10 text-sky-400 ${className}`.trim()}
				title="Static deployment"
				aria-label="Static deployment"
			>
				<Globe className="size-4" aria-hidden="true" />
			</div>
		);
	}

	return (
		<div
			className={`flex size-8 shrink-0 items-center justify-center rounded-lg border text-[10px] font-semibold tracking-tight ${style.className} ${className}`.trim()}
			title={formatServiceTypeLabel(serviceType)}
			aria-label={formatServiceTypeLabel(serviceType)}
		>
			{style.label}
		</div>
	);
}

export function ServiceTypeBadge({ deployMode, serviceType }: Pick<ServiceTypeIconProps, "deployMode" | "serviceType">) {
	if (deployMode === "container") {
		return (
			<span className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.03] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
				<Rocket className="size-3" />
				Container
			</span>
		);
	}

	return (
		<span className="inline-flex items-center gap-1 rounded-full border border-sky-500/20 bg-sky-500/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-sky-400">
			<FileCode2 className="size-3" />
			{formatServiceTypeLabel(serviceType)}
		</span>
	);
}
