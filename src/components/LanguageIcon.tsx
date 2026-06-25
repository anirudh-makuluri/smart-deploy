"use client";

import { Github } from "lucide-react";
import type { SimpleIcon } from "simple-icons";
import {
	siC,
	siCplusplus,
	siDart,
	siDotnet,
	siGo,
	siJavascript,
	siKotlin,
	siOpenjdk,
	siPhp,
	siPython,
	siRuby,
	siRust,
	siSwift,
	siTypescript,
} from "simple-icons";

type LanguageIconProps = {
	language?: string | null;
	className?: string;
};

const languageIcons: Record<string, SimpleIcon> = {
	c: siC,
	"c++": siCplusplus,
	dart: siDart,
	dotnet: siDotnet,
	go: siGo,
	java: siOpenjdk,
	javascript: siJavascript,
	kotlin: siKotlin,
	php: siPhp,
	python: siPython,
	ruby: siRuby,
	rust: siRust,
	swift: siSwift,
	typescript: siTypescript,
};

const languageLabels: Record<string, string> = {
	"c#": "C#",
	"c++": "C++",
	dotnet: ".NET",
	go: "Go",
	java: "Java",
	javascript: "JavaScript",
	php: "PHP",
	python: "Python",
	ruby: "Ruby",
	rust: "Rust",
	swift: "Swift",
	typescript: "TypeScript",
};

function normalizeLanguage(language?: string | null): string {
	return language?.trim().toLowerCase() ?? "";
}

function toReadableLabel(language: string): string {
	return languageLabels[language] ?? language.replace(/[-_]+/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function toAbbreviation(language: string): string {
	const compact = language.replace(/[^a-z0-9]/gi, "").toUpperCase();
	return compact.slice(0, 2) || "??";
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
			className={`flex size-6 shrink-0 items-center justify-center rounded-md border ${darkBrand ? "text-foreground" : ""} ${className}`.trim()}
			style={{ ...backgroundStyle, ...colorStyle }}
			title={label}
			aria-label={label}
		>
			<svg
				viewBox="0 0 24 24"
				className="size-3.5 fill-current"
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
			className={`flex size-6 shrink-0 items-center justify-center rounded-md border border-white/10 bg-white/[0.03] text-[9px] font-semibold tracking-tight text-foreground ${className}`.trim()}
			title={label}
			aria-label={label}
		>
			{abbreviation}
		</div>
	);
}

export default function LanguageIcon({ language, className = "" }: LanguageIconProps) {
	const normalizedLanguage = normalizeLanguage(language);
	if (!normalizedLanguage) {
		return <Github className={`size-6 shrink-0 text-muted-foreground ${className}`.trim()} aria-hidden="true" />;
	}

	const icon = languageIcons[normalizedLanguage];
	const label = toReadableLabel(normalizedLanguage);

	if (icon) {
		return <BrandGlyph icon={icon} label={label} className={className} />;
	}

	return <TextGlyph abbreviation={toAbbreviation(normalizedLanguage)} label={label} className={className} />;
}
