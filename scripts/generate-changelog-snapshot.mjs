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
const MAX_RAW_COMMITS = 100;

const MERGE_PR_RE = /Merge pull request #(\d+)/i;
const SUBJECT_PR_SUFFIX_RE = /\(#(\d+)\)\s*$/;
const CONVENTIONAL_PREFIX_RE = /^(feat|fix|docs|chore|refactor|perf|test|build|ci|style|revert)(\([^)]*\))?!?:\s*/i;

const NOISY_SUBJECT_RE = [
	/^wip\b/i,
	/^temp\b/i,
	/^tmp\b/i,
	/^minor\b/i,
	/^oops\b/i,
	/^merge branch\b/i,
	/^update changelog\b/i,
	/^updated changelog\b/i,
	/^changelog\b/i,
];

const LOW_SIGNAL_SUBJECT_RE = [
	/^a small bug$/i,
	/^need to check$/i,
	/^quick fix$/i,
	/^minor fix(?:es)?$/i,
	/^misc(?:ellaneous)?(?: changes)?$/i,
	/^update$/i,
	/^updated$/i,
	/^fix$/i,
	/^changes$/i,
];

const TYPE_LABEL = {
	feat: "Feature",
	fix: "Fix",
	docs: "Docs",
	refactor: "Refactor",
	perf: "Performance",
	test: "Test",
	build: "Build",
	ci: "CI",
	style: "Style",
	chore: "Maintenance",
	revert: "Revert",
};

function parsePrNumber(subject) {
	const merge = subject.match(MERGE_PR_RE);
	if (merge) return Number.parseInt(merge[1], 10);
	const suffix = subject.match(SUBJECT_PR_SUFFIX_RE);
	if (suffix) return Number.parseInt(suffix[1], 10);
	return null;
}

function simplifyVerbToken(token) {
	if (token === "updated" || token === "updating") return "update";
	if (token === "added" || token === "adding") return "add";
	if (token === "fixed" || token === "fixing") return "fix";
	if (token === "implemented" || token === "implementing") return "implement";
	if (token === "refactored" || token === "refactoring") return "refactor";
	if (token === "improved" || token === "improving") return "improve";
	return token;
}

function normalizeSubject(subject) {
	const noPrSuffix = subject.replace(SUBJECT_PR_SUFFIX_RE, "").trim();
	const parsedPrefix = noPrSuffix.match(CONVENTIONAL_PREFIX_RE);
	const type = parsedPrefix ? parsedPrefix[1].toLowerCase() : null;
	const message = noPrSuffix.replace(CONVENTIONAL_PREFIX_RE, "").replace(/\s+/g, " ").trim();

	if (!message) return null;
	if (MERGE_PR_RE.test(noPrSuffix)) return null;
	if (NOISY_SUBJECT_RE.some((re) => re.test(message))) return null;
	if (LOW_SIGNAL_SUBJECT_RE.some((re) => re.test(message))) return null;

	const first = message.charAt(0).toUpperCase();
	const rest = message.slice(1);
	const readable = `${first}${rest}`;
	const label = type && TYPE_LABEL[type] ? `${TYPE_LABEL[type]}: ` : "";

	const key = message
		.toLowerCase()
		.replace(/[^a-z0-9\s]/g, " ")
		.split(/\s+/)
		.filter(Boolean)
		.map(simplifyVerbToken)
		.filter((token) => !["the", "a", "an", "to", "for", "with", "and"].includes(token))
		.join(" ");

	if (!key) return null;

	return {
		displaySubject: `${label}${readable}`,
		similarityKey: key,
	};
}

const out = execFileSync(
	"git",
	["log", `-${MAX_RAW_COMMITS}`, `--pretty=format:%H${RS}%h${RS}%ad${RS}%aN${RS}%s`, "--date=short"],
	{ cwd: root, encoding: "utf-8", maxBuffer: 10 * 1024 * 1024 },
);

const rawCommits = [];
for (const line of out.trim().split("\n").filter(Boolean)) {
	const parts = line.split(RS);
	if (parts.length < 5) continue;
	const [hash, shortHash, date, author, ...rest] = parts;
	const subject = rest.join(RS);
	rawCommits.push({
		hash,
		shortHash,
		date,
		author,
		subject,
		prNumber: parsePrNumber(subject),
	});
}

const mergedByKey = new Map();
for (const commit of rawCommits) {
	const normalized = normalizeSubject(commit.subject);
	if (!normalized) continue;

	const existing = mergedByKey.get(normalized.similarityKey);
	if (!existing) {
		mergedByKey.set(normalized.similarityKey, {
			...commit,
			subject: normalized.displaySubject,
			mergeCount: 1,
		});
		continue;
	}

	existing.mergeCount += 1;
	if (normalized.displaySubject.length > existing.subject.length) {
		existing.subject = normalized.displaySubject;
	}
}

const commits = [...mergedByKey.values()].map((commit) => {
	if (commit.mergeCount <= 1) {
		return {
			hash: commit.hash,
			shortHash: commit.shortHash,
			date: commit.date,
			author: commit.author,
			subject: commit.subject,
			prNumber: commit.prNumber,
		};
	}

	return {
		hash: commit.hash,
		shortHash: commit.shortHash,
		date: commit.date,
		author: commit.author,
		subject: `${commit.subject} (+${commit.mergeCount - 1} related commits)`,
		prNumber: commit.prNumber,
	};
});

const target = path.join(root, "src", "data", "changelog-commits.json");
fs.mkdirSync(path.dirname(target), { recursive: true });
const payload = {
	generatedAt: new Date().toISOString(),
	rawCommitCount: rawCommits.length,
	commitCount: commits.length,
	commits,
};
fs.writeFileSync(target, `${JSON.stringify(payload, null, "\t")}\n`);
console.log(
	`Wrote ${commits.length} cleaned commits (from ${rawCommits.length} raw commits) to ${path.relative(root, target)}`,
);
