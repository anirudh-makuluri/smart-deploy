import { execSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

type SweepRow = {
	alpha: string;
	runIndex: number;
	label: string;
	tempDocs: number;
	target: string;
	avgMs: number;
	medianMs: number;
	p95Ms: number;
	avgCoverage: number;
};

const ROOT = path.join(__dirname, "..");
const SWEEP_OUT_DIR = path.join(ROOT, "benchmarks", "help-agent-scaling-alpha");
const ALPHAS = ["0", "0.5", "0.75", "1"];

function toCsvCell(value: string | number): string {
	const s = String(value);
	if (s.includes(",") || s.includes("\"") || s.includes("\n")) {
		return `"${s.replace(/"/g, "\"\"")}"`;
	}
	return s;
}

async function runOneAlpha(alpha: string): Promise<void> {
	const outDirRel = `benchmarks/help-agent-scaling-alpha/alpha-${alpha.replace(".", "_")}`;
	console.log(`\n[alpha-sweep] Running scaling benchmark for alpha=${alpha}`);
	execSync("npm run benchmark:help-agent:scaling", {
		cwd: ROOT,
		stdio: "inherit",
		env: {
			...process.env,
			MOSS_BENCHMARK_ALPHA: alpha,
			HELP_AGENT_SCALING_OUT_DIR: outDirRel,
		},
	});
}

async function combineReports(): Promise<void> {
	const rows: SweepRow[] = [];

	for (const alpha of ALPHAS) {
		const alphaDir = path.join(SWEEP_OUT_DIR, `alpha-${alpha.replace(".", "_")}`);
		const longCsv = path.join(alphaDir, "line-data-long.csv");
		const content = await fs.readFile(longCsv, "utf-8");
		const lines = content
			.trim()
			.split(/\r?\n/)
			.slice(1)
			.filter(Boolean);

		for (const line of lines) {
			const [runIndex, label, tempDocs, target, avgMs, medianMs, p95Ms, avgCoverage] = line.split(",");
			rows.push({
				alpha,
				runIndex: Number(runIndex),
				label,
				tempDocs: Number(tempDocs),
				target,
				avgMs: Number(avgMs),
				medianMs: Number(medianMs),
				p95Ms: Number(p95Ms),
				avgCoverage: Number(avgCoverage),
			});
		}
	}

	rows.sort((a, b) => {
		if (a.target !== b.target) return a.target.localeCompare(b.target);
		if (a.runIndex !== b.runIndex) return a.runIndex - b.runIndex;
		return Number(a.alpha) - Number(b.alpha);
	});

	const header = [
		"alpha",
		"run_index",
		"label",
		"temp_docs",
		"target",
		"avg_ms",
		"median_ms",
		"p95_ms",
		"avg_coverage",
	];
	const lines = [header.join(",")];
	for (const row of rows) {
		lines.push(
			[
				row.alpha,
				row.runIndex,
				row.label,
				row.tempDocs,
				row.target,
				row.avgMs,
				row.medianMs,
				row.p95Ms,
				row.avgCoverage,
			]
				.map(toCsvCell)
				.join(","),
		);
	}

	const outCsv = path.join(SWEEP_OUT_DIR, "alpha-sweep-summary.csv");
	await fs.mkdir(SWEEP_OUT_DIR, { recursive: true });
	await fs.writeFile(outCsv, `${lines.join("\n")}\n`, "utf-8");

	console.log(`\n[alpha-sweep] Combined summary written: ${path.relative(ROOT, outCsv)}`);
}

async function main() {
	await fs.mkdir(SWEEP_OUT_DIR, { recursive: true });
	for (const alpha of ALPHAS) {
		await runOneAlpha(alpha);
	}
	await combineReports();
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
