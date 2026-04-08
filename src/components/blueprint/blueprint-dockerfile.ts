export type DockerfileInsights = {
	baseImage: string;
	workdir: string;
	installCommand: string;
	buildCommand: string;
	exposePort: string;
	startCommand: string;
};

const INSTALL_PATTERNS = [
	/\bnpm\s+(ci|install)\b/i,
	/\byarn\s+install\b/i,
	/\bpnpm\s+install\b/i,
	/\bbun\s+install\b/i,
	/\bpip(?:3)?\s+install\b/i,
	/\bpoetry\s+install\b/i,
	/\bgo\s+mod\s+download\b/i,
	/\bgo\s+get\b/i,
];

const BUILD_PATTERNS = [
	/\bnpm\s+run\s+build\b/i,
	/\byarn\s+build\b/i,
	/\bpnpm\s+build\b/i,
	/\bbun\s+run\s+build\b/i,
	/\bpip(?:3)?\s+wheel\b/i,
	/\bpython\s+-m\s+build\b/i,
	/\bgo\s+build\b/i,
	/\bdotnet\s+publish\b/i,
];

function findInstruction(content: string, instruction: string, mode: "first" | "last" = "last") {
	const pattern = new RegExp(`^\\s*${instruction}\\s+(.+?)\\s*$`, "gim");
	let match: RegExpExecArray | null;
	let result: RegExpExecArray | null = null;
	while ((match = pattern.exec(content)) !== null) {
		result = match;
		if (mode === "first") break;
	}
	return result;
}

function replaceOrAppendInstruction(
	content: string,
	instruction: string,
	value: string,
	options?: { mode?: "first" | "last"; removeWhenEmpty?: boolean }
) {
	const mode = options?.mode ?? "last";
	const removeWhenEmpty = options?.removeWhenEmpty ?? false;
	const nextValue = value.trim();
	const normalized = content.replace(/\r\n/g, "\n");
	const lines = normalized.split("\n");
	const matcher = new RegExp(`^\\s*${instruction}\\b`, "i");
	const indexes = lines.reduce<number[]>((acc, line, index) => {
		if (matcher.test(line)) acc.push(index);
		return acc;
	}, []);

	if (removeWhenEmpty && !nextValue) {
		if (indexes.length === 0) return normalized;
		const removeIndex = mode === "first" ? indexes[0] : indexes[indexes.length - 1];
		lines.splice(removeIndex, 1);
		return lines.join("\n").trimEnd();
	}

	if (!nextValue) return normalized;

	const nextLine = `${instruction} ${nextValue}`;
	if (indexes.length > 0) {
		const updateIndex = mode === "first" ? indexes[0] : indexes[indexes.length - 1];
		lines[updateIndex] = nextLine;
		return lines.join("\n").trimEnd();
	}

	const trimmed = normalized.trimEnd();
	return trimmed ? `${trimmed}\n${nextLine}` : nextLine;
}

function splitRunSegments(command: string) {
	return command
		.split(/\s*(?:&&|;)\s*/g)
		.map((segment) => segment.trim())
		.filter(Boolean);
}

function findRunCommand(content: string, patterns: RegExp[]) {
	const matches = content.matchAll(/^\s*RUN\s+(.+?)\s*$/gim);
	let result = "";
	for (const match of matches) {
		const command = match[1]?.trim() ?? "";
		for (const segment of splitRunSegments(command)) {
			if (patterns.some((pattern) => pattern.test(segment))) {
				result = segment;
			}
		}
	}
	return result;
}

function replaceOrAppendRunCommand(
	content: string,
	value: string,
	patterns: RegExp[]
) {
	const nextValue = value.trim();
	const normalized = content.replace(/\r\n/g, "\n");
	const lines = normalized.split("\n");
	let targetIndex = -1;
	let targetSegmentIndex = -1;

	for (let index = 0; index < lines.length; index += 1) {
		const match = lines[index].match(/^\s*RUN\s+(.+?)\s*$/i);
		const command = match?.[1]?.trim() ?? "";
		const segments = splitRunSegments(command);
		for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex += 1) {
			if (patterns.some((pattern) => pattern.test(segments[segmentIndex]))) {
				targetIndex = index;
				targetSegmentIndex = segmentIndex;
			}
		}
	}

	if (!nextValue) {
		if (targetIndex === -1) return normalized;
		const currentMatch = lines[targetIndex].match(/^\s*RUN\s+(.+?)\s*$/i);
		const currentSegments = splitRunSegments(currentMatch?.[1]?.trim() ?? "");
		if (targetSegmentIndex !== -1) {
			currentSegments.splice(targetSegmentIndex, 1);
		}
		if (currentSegments.length > 0) {
			lines[targetIndex] = `RUN ${currentSegments.join(" && ")}`;
		} else {
			lines.splice(targetIndex, 1);
		}
		return lines.join("\n").trimEnd();
	}

	const nextLine = `RUN ${nextValue}`;
	if (targetIndex !== -1) {
		const currentMatch = lines[targetIndex].match(/^\s*RUN\s+(.+?)\s*$/i);
		const currentSegments = splitRunSegments(currentMatch?.[1]?.trim() ?? "");
		if (targetSegmentIndex !== -1) {
			currentSegments[targetSegmentIndex] = nextValue;
			lines[targetIndex] = `RUN ${currentSegments.join(" && ")}`;
		} else {
			lines[targetIndex] = nextLine;
		}
		return lines.join("\n").trimEnd();
	}

	const insertIndex = lines.findLastIndex((line) => /^\s*WORKDIR\b/i.test(line));
	if (insertIndex !== -1) {
		lines.splice(insertIndex + 1, 0, nextLine);
		return lines.join("\n").trimEnd();
	}

	const trimmed = normalized.trimEnd();
	return trimmed ? `${trimmed}\n${nextLine}` : nextLine;
}

export function parseDockerfileInsights(content: string): DockerfileInsights {
	const fromMatch = findInstruction(content, "FROM", "first");
	const workdirMatch = findInstruction(content, "WORKDIR");
	const exposeMatch = findInstruction(content, "EXPOSE");
	const cmdMatch = findInstruction(content, "CMD");

	return {
		baseImage: fromMatch?.[1]?.trim() ?? "",
		workdir: workdirMatch?.[1]?.trim() ?? "",
		installCommand: findRunCommand(content, INSTALL_PATTERNS),
		buildCommand: findRunCommand(content, BUILD_PATTERNS),
		exposePort: exposeMatch?.[1]?.trim().split(/\s+/)[0] ?? "",
		startCommand: cmdMatch?.[1]?.trim() ?? "",
	};
}

export function updateDockerfileField(
	content: string,
	field: keyof DockerfileInsights,
	value: string
) {
	switch (field) {
		case "baseImage":
			return replaceOrAppendInstruction(content, "FROM", value, { mode: "first" });
		case "workdir":
			return replaceOrAppendInstruction(content, "WORKDIR", value, { removeWhenEmpty: true });
		case "installCommand":
			return replaceOrAppendRunCommand(content, value, INSTALL_PATTERNS);
		case "buildCommand":
			return replaceOrAppendRunCommand(content, value, BUILD_PATTERNS);
		case "exposePort":
			return replaceOrAppendInstruction(content, "EXPOSE", value, { removeWhenEmpty: true });
		case "startCommand":
			return replaceOrAppendInstruction(content, "CMD", value, { removeWhenEmpty: true });
		default:
			return content;
	}
}
