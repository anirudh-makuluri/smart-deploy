import { readFileSync } from "node:fs";

const report = JSON.parse(readFileSync(process.argv[2], "utf8"));
if (
	report.version !== "0.9.18" || report.mode !== "full" || report.ok !== true ||
	report.error !== null || !Array.isArray(report.projects) || report.projects.length !== 1 ||
	report.projects[0].complete !== true || report.projects[0].skippedChecks.length !== 0 ||
	report.summary.errorCount !== 0 || !Number.isFinite(report.summary.score) || report.summary.score < 95
) {
	throw new Error("Release requires a complete, unfiltered React Doctor 0.9.18 scan with zero errors and score >=95.");
}
console.log(`React Doctor release gate: ${report.summary.score}/100 (${report.projects[0].scannedFileCount} files).`);
