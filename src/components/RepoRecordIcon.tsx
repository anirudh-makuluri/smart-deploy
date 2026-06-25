"use client";

import { Box } from "lucide-react";
import type { SimpleIcon } from "simple-icons";
import {
	siAngular,
	siAstro,
	siDjango,
	siExpress,
	siFastapi,
	siFastify,
	siFlask,
	siHtml5,
	siNestjs,
	siNextdotjs,
	siNuxt,
	siReact,
	siSvelte,
	siVite,
	siVuedotjs,
} from "simple-icons";
import type { DeploymentKind, StaticServiceType } from "@/app/types";

type RepoRecordIconProps = {
	deployMode: DeploymentKind;
	serviceType?: StaticServiceType;
	framework?: string;
	className?: string;
};

type IconMatch = {
	icon?: SimpleIcon;
	label: string;
	abbreviation: string;
};

const frameworkIcons: Record<string, SimpleIcon> = {
	angular: siAngular,
	astro: siAstro,
	django: siDjango,
	express: siExpress,
	fastapi: siFastapi,
	fastify: siFastify,
	flask: siFlask,
	nestjs: siNestjs,
	nextjs: siNextdotjs,
	nuxt: siNuxt,
	react: siReact,
	svelte: siSvelte,
	vite: siVite,
	vue: siVuedotjs,
};

const serviceTypeIcons: Partial<Record<StaticServiceType, SimpleIcon>> = {
	angular: siAngular,
	astro: siAstro,
	cra: siReact,
	"next-export": siNextdotjs,
	"static-html": siHtml5,
	svelte: siSvelte,
	vite: siVite,
	vue: siVuedotjs,
};

const frameworkLabels: Record<string, string> = {
	fastapi: "FastAPI",
	fastify: "Fastify",
	nestjs: "NestJS",
	nextjs: "Next.js",
	nuxt: "Nuxt",
	vue: "Vue.js",
};

const serviceTypeLabels: Record<StaticServiceType, string> = {
	angular: "Angular",
	astro: "Astro",
	cra: "Create React App",
	"next-export": "Next.js Export",
	"static-html": "Static HTML",
	svelte: "Svelte",
	vite: "Vite",
	vue: "Vue",
};

function normalizeIconKey(value?: string): string {
	return (value ?? "").trim().toLowerCase();
}

function toReadableLabel(value: string, kind: "framework" | "serviceType"): string {
	if (kind === "framework") {
		return frameworkLabels[value] ?? value.replace(/[-_]+/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
	}
	return serviceTypeLabels[value as StaticServiceType] ?? value.replace(/[-_]+/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function toAbbreviation(value: string): string {
	const compact = value.replace(/[^a-z0-9]/gi, "").toUpperCase();
	return compact.slice(0, 2) || "??";
}

function resolveIconMatch(framework?: string, serviceType?: StaticServiceType): IconMatch | null {
	const frameworkKey = normalizeIconKey(framework);
	if (frameworkKey) {
		return {
			icon: frameworkIcons[frameworkKey],
			label: toReadableLabel(frameworkKey, "framework"),
			abbreviation: toAbbreviation(frameworkKey),
		};
	}

	if (serviceType) {
		return {
			icon: serviceTypeIcons[serviceType],
			label: toReadableLabel(serviceType, "serviceType"),
			abbreviation: toAbbreviation(serviceType),
		};
	}

	return null;
}

function hexToRgb(hex: string): string {
	const normalized = hex.trim().replace(/^#/, "");
	if (normalized.length !== 6) return "255 255 255";
	const pairs = normalized.match(/.{1,2}/g);
	if (!pairs || pairs.length !== 3) return "255 255 255";
	return pairs.map((pair) => Number.parseInt(pair, 16)).join(" ");
}

function isDarkHex(hex: string): boolean {
	const normalized = hex.trim().replace(/^#/, "");
	if (normalized.length !== 6) return false;
	const pairs = normalized.match(/.{1,2}/g);
	if (!pairs || pairs.length !== 3) return false;
	const [red, green, blue] = pairs.map((pair) => Number.parseInt(pair, 16) / 255);
	const luminance = (0.2126 * red) + (0.7152 * green) + (0.0722 * blue);
	return luminance < 0.32;
}

function BrandGlyph({ icon, label, className = "" }: { icon: SimpleIcon; label: string; className?: string }) {
	const darkBrand = isDarkHex(icon.hex);
	const rgb = hexToRgb(icon.hex);
	const colorStyle = darkBrand ? undefined : { color: `#${icon.hex}` };
	const backgroundStyle = {
		backgroundColor: darkBrand ? "rgba(255,255,255,0.04)" : `rgb(${rgb} / 0.14)`,
		borderColor: darkBrand ? "rgba(255,255,255,0.12)" : `rgb(${rgb} / 0.24)`,
	};

	return (
		<div
			className={`flex size-8 shrink-0 items-center justify-center rounded-lg border ${darkBrand ? "text-foreground" : ""} ${className}`.trim()}
			style={{ ...backgroundStyle, ...colorStyle }}
			title={label}
			aria-label={label}
		>
			<svg
				viewBox="0 0 24 24"
				className="size-4 fill-current"
				aria-hidden="true"
			>
				<path d={icon.path} />
			</svg>
		</div>
	);
}

function TextGlyph({ abbreviation, label, className = "" }: { abbreviation: string; label: string; className?: string }) {
	return (
		<div
			className={`flex size-8 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/[0.03] text-[10px] font-semibold tracking-tight text-foreground ${className}`.trim()}
			title={label}
			aria-label={label}
		>
			{abbreviation}
		</div>
	);
}

export default function RepoRecordIcon({ deployMode, serviceType, framework, className = "" }: RepoRecordIconProps) {
	void deployMode;
	const match = resolveIconMatch(framework, serviceType);
	if (!match) {
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

	if (match.icon) {
		return <BrandGlyph icon={match.icon} label={match.label} className={className} />;
	}

	return <TextGlyph abbreviation={match.abbreviation} label={match.label} className={className} />;
}
