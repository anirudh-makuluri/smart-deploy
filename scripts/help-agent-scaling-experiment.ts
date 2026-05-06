import { execSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

type Provider = {
	key: "render" | "railway" | "vercel";
	label: string;
	llmsFullUrl: string;
	maxDocs: number;
	maxCharsPerDoc: number;
	keywords: string[];
};

type TargetResult = {
	target: string;
	caseId: string;
	ms: number;
	coverage: number;
	matchedSignals: string[];
	topSources: string[];
	chunkCount: number;
	notes?: string;
};

type BenchmarkOutput = {
	generatedAt: string;
	candidateUrl: string | null;
	results: TargetResult[];
};

type TargetSummary = {
	avgMs: number;
	medianMs: number;
	p95Ms: number;
	avgCoverage: number;
	caseCount: number;
};

type RunSummary = {
	runIndex: number;
	label: string;
	tempDocCount: number;
	addedProvider?: string;
	generatedAt: string;
	byTarget: Record<string, TargetSummary>;
	outputFile: string;
};

type MossReference = {
	avgMs: number;
	avgCoverage: number;
} | null;

const ROOT = path.join(__dirname, "..");
const TEMP_DOCS_DIR = path.join(ROOT, "temp-docs");
const outDirRelative = process.env.HELP_AGENT_SCALING_OUT_DIR?.trim() || "benchmarks/help-agent-scaling";
const OUT_DIR = path.isAbsolute(outDirRelative) ? outDirRelative : path.join(ROOT, outDirRelative);
const PROVIDERS: Provider[] = [
	{
		key: "render",
		label: "Render",
		llmsFullUrl: "https://render.com/docs/llms-full.txt",
		maxDocs: 120,
		maxCharsPerDoc: 12000,
		keywords: [
			"deploy",
			"deployment",
			"build",
			"troubleshoot",
			"error",
			"log",
			"health",
			"preview",
			"domain",
			"dns",
			"ssl",
			"websocket",
			"environment variable",
			"postgres",
			"permission",
			"rollback",
		],
	},
	{
		key: "railway",
		label: "Railway",
		llmsFullUrl: "https://docs.railway.com/llms-full.txt",
		maxDocs: 120,
		maxCharsPerDoc: 12000,
		keywords: [
			"deploy",
			"deployment",
			"troubleshoot",
			"error",
			"log",
			"network",
			"domain",
			"dns",
			"ssl",
			"environment variable",
			"database",
			"postgres",
			"worker",
			"websocket",
			"health",
			"rollback",
		],
	},
	{
		key: "vercel",
		label: "Vercel",
		llmsFullUrl: "https://vercel.com/docs/llms-full.txt",
		maxDocs: 180,
		maxCharsPerDoc: 12000,
		keywords: [
			"deploy",
			"deployment",
			"build",
			"troubleshoot",
			"error",
			"log",
			"health",
			"preview",
			"domain",
			"dns",
			"ssl",
			"websocket",
			"environment variable",
			"database",
			"oauth",
			"permission",
		],
	},
];

function average(values: number[]): number {
	if (values.length === 0) return 0;
	return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function percentile(values: number[], p: number): number {
	if (values.length === 0) return 0;
	const sorted = [...values].sort((a, b) => a - b);
	const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
	return sorted[idx];
}

function median(values: number[]): number {
	if (values.length === 0) return 0;
	const sorted = [...values].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	if (sorted.length % 2 === 1) return sorted[mid];
	return Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

function splitIntoSections(markdown: string): string[] {
	const text = markdown.replace(/\r\n/g, "\n");
	const lines = text.split("\n");
	const starts: number[] = [];
	for (let i = 0; i < lines.length; i += 1) {
		if (lines[i].startsWith("# ")) starts.push(i);
	}
	if (starts.length === 0) return [text.trim()].filter(Boolean);
	const sections: string[] = [];
	for (let i = 0; i < starts.length; i += 1) {
		const start = starts[i];
		const end = i + 1 < starts.length ? starts[i + 1] : lines.length;
		const section = lines.slice(start, end).join("\n").trim();
		if (section.length > 0) sections.push(section);
	}
	return sections;
}

function cleanLine(line: string): string {
	return line
		.replace(/\s+/g, " ")
		.replace(/[\u0000-\u001f]/g, "")
		.trim();
}

function sectionTitle(section: string): string {
	const firstHeading = section
		.split("\n")
		.find((line) => line.startsWith("# "))
		?.replace(/^#\s+/, "")
		.trim();
	if (firstHeading) return firstHeading;
	return "Untitled";
}

function sectionScore(section: string, keywords: string[]): number {
	const lower = section.toLowerCase();
	let score = 0;
	for (const keyword of keywords) {
		if (lower.includes(keyword)) score += 1;
	}
	score += Math.min(10, Math.floor(section.length / 1200));
	return score;
}

function normalizeForFilename(value: string): string {
	return value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 48);
}

async function fetchText(url: string): Promise<string> {
	const response = await fetch(url, {
		redirect: "follow",
		headers: {
			"user-agent": "smart-deploy-benchmark-crawler/1.0",
		},
	});
	if (!response.ok) {
		throw new Error(`Failed to fetch ${url}: ${response.status}`);
	}
	return response.text();
}

async function wipeTempDocs(): Promise<void> {
	await fs.mkdir(TEMP_DOCS_DIR, { recursive: true });
	const names = await fs.readdir(TEMP_DOCS_DIR);
	for (const name of names) {
		if (!name.endsWith(".md")) continue;
		await fs.unlink(path.join(TEMP_DOCS_DIR, name));
	}
}

async function countTempDocs(): Promise<number> {
	try {
		const names = await fs.readdir(TEMP_DOCS_DIR);
		return names.filter((name) => name.endsWith(".md")).length;
	} catch {
		return 0;
	}
}

async function ingestProvider(provider: Provider): Promise<number> {
	console.log(`\n[scaling] Fetching ${provider.label} corpus from ${provider.llmsFullUrl}`);
	const raw = await fetchText(provider.llmsFullUrl);
	const sections = splitIntoSections(raw);
	const ranked = sections
		.map((section) => ({
			section,
			title: sectionTitle(section),
			score: sectionScore(section, provider.keywords),
		}))
		.filter((item) => item.score > 0)
		.sort((a, b) => b.score - a.score || b.section.length - a.section.length)
		.slice(0, provider.maxDocs);

	const dateStamp = new Date().toISOString();
	let written = 0;
	for (let i = 0; i < ranked.length; i += 1) {
		const item = ranked[i];
		const body = item.section.slice(0, provider.maxCharsPerDoc);
		const title = cleanLine(item.title) || `${provider.label} Doc`;
		const slug = normalizeForFilename(title) || `doc-${i + 1}`;
		const filename = `TEMP_${provider.key.toUpperCase()}_${String(i + 1).padStart(3, "0")}_${slug}.md`;
		const markdown = [
			`# ${title}`,
			"",
			`Source: ${provider.llmsFullUrl}`,
			`Provider: ${provider.label}`,
			`CapturedAt: ${dateStamp}`,
			`SectionScore: ${item.score}`,
			"",
			body,
			"",
		].join("\n");
		await fs.writeFile(path.join(TEMP_DOCS_DIR, filename), markdown, "utf-8");
		written += 1;
	}
	console.log(`[scaling] Added ${written} temp docs for ${provider.label}`);
	return written;
}

function summarizeTarget(entries: TargetResult[]): TargetSummary {
	const msValues = entries.map((entry) => entry.ms);
	const coverageValues = entries.map((entry) => entry.coverage);
	return {
		avgMs: average(msValues),
		medianMs: median(msValues),
		p95Ms: percentile(msValues, 95),
		avgCoverage: average(coverageValues),
		caseCount: entries.length,
	};
}

async function runBenchmark(label: string, runIndex: number, addedProvider?: string): Promise<RunSummary> {
	await fs.mkdir(OUT_DIR, { recursive: true });
	const outputPath = path.join(OUT_DIR, `${label}.json`);

	console.log(`\n[scaling] Running benchmark for checkpoint: ${label}`);
	execSync("npm run benchmark:help-agent", {
		cwd: ROOT,
		stdio: "inherit",
		env: {
			...process.env,
			HELP_AGENT_BENCHMARK_OUT: path.relative(ROOT, outputPath).replace(/\\/g, "/"),
		},
	});

	const raw = await fs.readFile(outputPath, "utf-8");
	const parsed = JSON.parse(raw) as BenchmarkOutput;
	const grouped = parsed.results.reduce<Record<string, TargetResult[]>>((acc, entry) => {
		acc[entry.target] ??= [];
		acc[entry.target].push(entry);
		return acc;
	}, {});

	const byTarget: Record<string, TargetSummary> = {};
	for (const [target, entries] of Object.entries(grouped)) {
		byTarget[target] = summarizeTarget(entries);
	}

	return {
		runIndex,
		label,
		tempDocCount: await countTempDocs(),
		addedProvider,
		generatedAt: parsed.generatedAt,
		byTarget,
		outputFile: path.relative(ROOT, outputPath).replace(/\\/g, "/"),
	};
}

function toCsvCell(value: string | number | null | undefined): string {
	if (value === null || value === undefined) return "";
	const str = String(value);
	if (str.includes(",") || str.includes("\"") || str.includes("\n")) {
		return `"${str.replace(/"/g, "\"\"")}"`;
	}
	return str;
}

async function writeReports(runs: RunSummary[]): Promise<void> {
	const mossReference = await readMossReference();
	const summaryCsvPath = path.join(OUT_DIR, "line-data.csv");
	const longCsvPath = path.join(OUT_DIR, "line-data-long.csv");
	const markdownPath = path.join(OUT_DIR, "overview.md");

	const summaryHeader = [
		"run_index",
		"label",
		"temp_docs",
		"added_provider",
		"baseline_avg_ms",
		"baseline_median_ms",
		"baseline_p95_ms",
		"baseline_avg_coverage",
		"moss_avg_ms",
		"moss_median_ms",
		"moss_p95_ms",
		"moss_avg_coverage",
		"moss_available",
		"moss_reference_avg_ms",
		"moss_reference_avg_coverage",
	];
	const summaryRows = [summaryHeader.join(",")];

	const longHeader = ["run_index", "label", "temp_docs", "target", "avg_ms", "median_ms", "p95_ms", "avg_coverage"];
	const longRows = [longHeader.join(",")];

	const mdLines: string[] = [];
	mdLines.push("# Help Agent Scaling Benchmark Overview");
	mdLines.push("");
	mdLines.push(`Generated at: ${new Date().toISOString()}`);
	mdLines.push("");
	if (mossReference) {
		mdLines.push(
			`Moss reference (from existing benchmark.txt): avg latency ${mossReference.avgMs} ms, avg coverage ${mossReference.avgCoverage}%.`,
		);
	} else {
		mdLines.push("Moss reference not found in benchmark.txt.");
	}
	mdLines.push("");
	mdLines.push("## Run Summary");
	mdLines.push("");
	mdLines.push("| Run | Label | Temp Docs | Added Provider | Baseline Avg ms | Baseline Avg Coverage | Moss Avg ms | Moss Avg Coverage | Moss Available |");
	mdLines.push("| --- | --- | ---: | --- | ---: | ---: | ---: | ---: | --- |");

	for (const run of runs) {
		const baseline = run.byTarget.baseline;
		const moss = run.byTarget.moss;
		summaryRows.push(
			[
				run.runIndex,
				run.label,
				run.tempDocCount,
				run.addedProvider ?? "none",
				baseline?.avgMs ?? "",
				baseline?.medianMs ?? "",
				baseline?.p95Ms ?? "",
				baseline?.avgCoverage ?? "",
				moss?.avgMs ?? "",
				moss?.medianMs ?? "",
				moss?.p95Ms ?? "",
				moss?.avgCoverage ?? "",
				moss ? "true" : "false",
				mossReference?.avgMs ?? "",
				mossReference?.avgCoverage ?? "",
			]
				.map((value) => toCsvCell(value))
				.join(","),
		);

		for (const target of Object.keys(run.byTarget)) {
			const targetSummary = run.byTarget[target];
			longRows.push(
				[
					run.runIndex,
					run.label,
					run.tempDocCount,
					target,
					targetSummary.avgMs,
					targetSummary.medianMs,
					targetSummary.p95Ms,
					targetSummary.avgCoverage,
				]
					.map((value) => toCsvCell(value))
					.join(","),
			);
		}
		if (mossReference && !run.byTarget.moss) {
			longRows.push(
				[
					run.runIndex,
					run.label,
					run.tempDocCount,
					"moss_reference",
					mossReference.avgMs,
					mossReference.avgMs,
					mossReference.avgMs,
					mossReference.avgCoverage,
				]
					.map((value) => toCsvCell(value))
					.join(","),
			);
		}

		mdLines.push(
			`| ${run.runIndex} | ${run.label} | ${run.tempDocCount} | ${run.addedProvider ?? "none"} | ${baseline?.avgMs ?? "n/a"} | ${baseline?.avgCoverage ?? "n/a"}% | ${moss?.avgMs ?? "n/a"} | ${moss?.avgCoverage ?? "n/a"}% | ${moss ? "yes" : "no"} |`,
		);
	}

	mdLines.push("");
	mdLines.push("## Per-Run Detailed Cases");
	mdLines.push("");

	for (const run of runs) {
		const raw = await fs.readFile(path.join(ROOT, run.outputFile), "utf-8");
		const parsed = JSON.parse(raw) as BenchmarkOutput;
		const grouped = parsed.results.reduce<Record<string, TargetResult[]>>((acc, entry) => {
			acc[entry.target] ??= [];
			acc[entry.target].push(entry);
			return acc;
		}, {});

		mdLines.push(`### Run ${run.runIndex}: ${run.label}`);
		mdLines.push("");
		mdLines.push(`- Temp docs: ${run.tempDocCount}`);
		mdLines.push(`- Added provider: ${run.addedProvider ?? "none"}`);
		mdLines.push(`- Output JSON: \`${run.outputFile}\``);
		mdLines.push("");

		for (const [target, entries] of Object.entries(grouped)) {
			mdLines.push(`#### Target: ${target}`);
			mdLines.push("");
			mdLines.push("| caseId | ms | coverage | chunkCount | topSources | matchedSignals |");
			mdLines.push("| --- | ---: | ---: | ---: | --- | --- |");
			for (const entry of entries) {
				mdLines.push(
					`| ${entry.caseId} | ${entry.ms} | ${entry.coverage}% | ${entry.chunkCount} | ${entry.topSources.join(", ")} | ${entry.matchedSignals.join(", ")} |`,
				);
			}
			mdLines.push("");
		}
	}

	await fs.writeFile(summaryCsvPath, `${summaryRows.join("\n")}\n`, "utf-8");
	await fs.writeFile(longCsvPath, `${longRows.join("\n")}\n`, "utf-8");
	await fs.writeFile(markdownPath, `${mdLines.join("\n")}\n`, "utf-8");
}

async function readMossReference(): Promise<MossReference> {
	try {
		const benchmarkTxt = await fs.readFile(path.join(ROOT, "benchmark.txt"), "utf-8");
		const match = /moss summary:\s*avg latency\s*(\d+)\s*ms.*?avg coverage\s*(\d+)%/is.exec(benchmarkTxt);
		if (!match) return null;
		return {
			avgMs: Number(match[1]),
			avgCoverage: Number(match[2]),
		};
	} catch {
		return null;
	}
}

async function main() {
	await fs.mkdir(OUT_DIR, { recursive: true });
	await wipeTempDocs();

	const runs: RunSummary[] = [];
	runs.push(await runBenchmark("run-00-baseline", 0));

	let runIndex = 1;
	for (const provider of PROVIDERS) {
		await ingestProvider(provider);
		runs.push(await runBenchmark(`run-0${runIndex}-${provider.key}`, runIndex, provider.key));
		runIndex += 1;
	}

	await writeReports(runs);

	console.log("\n[scaling] Completed.");
	console.log(`[scaling] Overview: ${path.relative(ROOT, path.join(OUT_DIR, "overview.md"))}`);
	console.log(`[scaling] Line data: ${path.relative(ROOT, path.join(OUT_DIR, "line-data.csv"))}`);
	console.log(`[scaling] Long-form line data: ${path.relative(ROOT, path.join(OUT_DIR, "line-data-long.csv"))}`);
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
