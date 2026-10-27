import { open, writeFile } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { demoWorkloadTemplate } from "../dist/lib/aws/demoWorkload.js";

// Compile with npm run ws:build first. Pure rendering: never calls AWS or resolves secrets.
if (process.argv.length !== 4 || !process.argv.slice(2).every(isAbsolute)) throw Error("Usage: node scripts/render-demo-workload.mjs ABSOLUTE_PLAN_JSON NEW_ABSOLUTE_OUTPUT_JSON");
const file = await open(process.argv[2], "r");
try {
  const metadata = await file.stat(); if (!metadata.isFile() || metadata.size < 1 || metadata.size > 32768) throw Error("Bounded operator plan file required.");
  const bytes = Buffer.alloc(32769); let length = 0;
  while (length < bytes.length) { const part = await file.read(bytes, length, bytes.length - length, null); if (!part.bytesRead) break; length += part.bytesRead; }
  if (!length || length > 32768) throw Error("Bounded operator plan file required.");
  const template = demoWorkloadTemplate(JSON.parse(bytes.subarray(0, length).toString("utf8")));
  await writeFile(process.argv[3], JSON.stringify(template, null, 2) + "\n", { flag: "wx", mode: 0o600 });
} finally { await file.close(); }
