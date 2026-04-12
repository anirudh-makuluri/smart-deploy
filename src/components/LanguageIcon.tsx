"use client";

import { Github } from "lucide-react";

type LanguageIconProps = {
	language?: string | null;
	className?: string;
};

const languageStyles: Record<string, { label: string; className: string }> = {
	typescript: {
		label: "TS",
		className: "bg-[#3178c6]/15 text-[#3178c6] border-[#3178c6]/25",
	},
	javascript: {
		label: "JS",
		className: "bg-[#f7df1e]/20 text-[#c3a600] border-[#f7df1e]/30",
	},
	python: {
		label: "PY",
		className: "bg-[#3776ab]/15 text-[#3776ab] border-[#3776ab]/25",
	},
	java: {
		label: "JV",
		className: "bg-[#f89820]/15 text-[#f89820] border-[#f89820]/25",
	},
	go: {
		label: "GO",
		className: "bg-[#00add8]/15 text-[#00add8] border-[#00add8]/25",
	},
	rust: {
		label: "RS",
		className: "bg-[#dea584]/15 text-[#a8632e] border-[#dea584]/25",
	},
	php: {
		label: "PHP",
		className: "bg-[#777bb4]/15 text-[#777bb4] border-[#777bb4]/25",
	},
	"c#": {
		label: "C#",
		className: "bg-[#68217a]/15 text-[#68217a] border-[#68217a]/25",
	},
	"c++": {
		label: "C++",
		className: "bg-[#00599c]/15 text-[#00599c] border-[#00599c]/25",
	},
	c: {
		label: "C",
		className: "bg-[#a8b9cc]/20 text-[#5c7085] border-[#a8b9cc]/30",
	},
	ruby: {
		label: "RB",
		className: "bg-[#cc342d]/15 text-[#cc342d] border-[#cc342d]/25",
	},
	kotlin: {
		label: "KT",
		className: "bg-[#7f52ff]/15 text-[#7f52ff] border-[#7f52ff]/25",
	},
	swift: {
		label: "SW",
		className: "bg-[#f05138]/15 text-[#f05138] border-[#f05138]/25",
	},
	dart: {
		label: "DT",
		className: "bg-[#0175c2]/15 text-[#0175c2] border-[#0175c2]/25",
	},
};

function normalizeLanguage(language?: string | null) {
	return language?.trim().toLowerCase() ?? "";
}

export default function LanguageIcon({ language, className = "" }: LanguageIconProps) {
	const normalizedLanguage = normalizeLanguage(language);
	const style = normalizedLanguage ? languageStyles[normalizedLanguage] : null;

	if (!style) {
		return <Github className={`size-6 shrink-0 text-muted-foreground ${className}`.trim()} aria-hidden="true" />;
	}

	return (
		<div
			className={`flex size-6 shrink-0 items-center justify-center rounded-md border text-[10px] font-semibold tracking-tight ${style.className} ${className}`.trim()}
			title={language ?? undefined}
			aria-label={language ?? "Repository"}
		>
			{style.label}
		</div>
	);
}
