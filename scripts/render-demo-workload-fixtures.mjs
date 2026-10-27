import { stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { demoWorkloadFixture } from "../dist/demo-validation/tests/helpers/demoWorkloadPlan.js";
import { demoWorkloadTemplate } from "../dist/demo-validation/src/lib/aws/demoWorkload.js";
if (process.argv.length !== 3 || !path.isAbsolute(process.argv[2]) || !(await stat(process.argv[2])).isDirectory()) throw Error("An existing absolute offline fixture output directory is required.");
const fixture = await demoWorkloadFixture();
try {
  const build = { ...fixture.plan, phase: "build", certificateArn: "", images: { worker: "", tls: "", publishedV1: "", publishedV2: "", preview: "" } };
  for (const [label, plan] of [["build", build], ["runtime", fixture.plan]]) {
    for (const [suffix, value] of [["plan", plan], ["template", demoWorkloadTemplate(plan)]]) await writeFile(path.join(process.argv[2], label + "-" + suffix + ".json"), JSON.stringify(value, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  }
} finally { await fixture.dispose(); }
