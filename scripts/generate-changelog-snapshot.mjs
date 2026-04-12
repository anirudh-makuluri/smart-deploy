/**
 * Regenerates `src/data/changelog-commits.json` from `git log`.
 * Run from repo root: `node scripts/generate-changelog-snapshot.mjs`
 * Or: `npm run changelog:snapshot`
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const RS = "\u001e";

const MERGE_PR_RE = /Merge pull request #(\d+)/i;
const SUBJECT_PR_SUFFIX_RE = /\(#(\d+)\)\s*$/;

function parsePrNumber(subject) {
	const merge = subject.match(MERGE_PR_RE);
	if (merge) return Number.parseInt(merge[1], 10);
	const suffix = subject.match(SUBJECT_PR_SUFFIX_RE);
	if (suffix) return Number.parseInt(suffix[1], 10);
	return null;
}

const out = execFileSync(
	"git",
	["log", "-120", `--pretty=format:%H${RS}%h${RS}%ad${RS}%aN${RS}%s`, "--date=short"],
	{ cwd: root, encoding: "utf-8", maxBuffer: 10 * 1024 * 1024 },
);

const commits = [];
for (const line of out.trim().split("\n").filter(Boolean)) {
	const parts = line.split(RS);
	if (parts.length < 5) continue;
	const [hash, shortHash, date, author, ...rest] = parts;
	const subject = rest.join(RS);
	commits.push({
		hash,
		shortHash,
		date,
		author,
		subject,
		prNumber: parsePrNumber(subject),
	});
}

const target = path.join(root, "src", "data", "changelog-commits.json");
fs.mkdirSync(path.dirname(target), { recursive: true });
const payload = {
	generatedAt: new Date().toISOString(),
	commitCount: commits.length,
	commits,
};
fs.writeFileSync(target, `${JSON.stringify(payload, null, "\t")}\n`);
console.log(`Wrote ${commits.length} commits to ${path.relative(root, target)}`);
