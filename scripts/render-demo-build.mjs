import { open, writeFile } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { demoBuildPlan } from "../dist/lib/aws/demoBuildPlan.js";
if (process.argv.length !== 4 || !process.argv.slice(2).every(isAbsolute)) throw Error("Usage: node scripts/render-demo-build.mjs ABSOLUTE_INPUT_JSON NEW_ABSOLUTE_OUTPUT_JSON");
const file = await open(process.argv[2], "r");
try {
  const metadata = await file.stat(); if (!metadata.isFile() || metadata.size < 1 || metadata.size > 32768) throw Error("Bounded operator input required.");
  const bytes = Buffer.alloc(32769); let length = 0;
  while (length < bytes.length) { const part = await file.read(bytes, length, bytes.length - length, null); if (!part.bytesRead) break; length += part.bytesRead; }
  if (!length || length > 32768) throw Error("Bounded operator input required.");
  await writeFile(process.argv[3], JSON.stringify(demoBuildPlan(JSON.parse(bytes.subarray(0, length).toString("utf8"))), null, 2) + "\n", { flag: "wx", mode: 0o600 });
} finally { await file.close(); }
