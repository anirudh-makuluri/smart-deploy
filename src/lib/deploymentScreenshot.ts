import config from "../config";
import { getSupabaseServer } from "./supabaseServer";

async function launchChromiumForScreenshot() {
	const preferServerlessLauncher =
		process.env.PLAYWRIGHT_USE_SERVERLESS_CHROMIUM === "1" ||
		Boolean(process.env.VERCEL) ||
		Boolean(process.env.AWS_EXECUTION_ENV) ||
		Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME);

	if (preferServerlessLauncher) {
		try {
			const [playwrightCore, sparticuzModule] = await Promise.all([
				import("playwright-core"),
				import("@sparticuz/chromium"),
			]);
			const chromium = sparticuzModule.default;
			const executablePath = await chromium.executablePath();

			return await playwrightCore.chromium.launch({
				args: chromium.args,
				executablePath,
				headless: true,
			});
		} catch (err) {
			console.warn("[Screenshot] Serverless Chromium launch failed, falling back to Playwright package", err);
		}
	}

	const { chromium } = await import("playwright");
	return chromium.launch({ headless: true });
}

function sanitizePathSegment(s: string) {
	// Keep it filesystem/DNS friendly for storage object keys.
	return s
		.toLowerCase()
		.replace(/[^a-z0-9-_]/g, "-")
		.replace(/-+/g, "-")
		.replace(/^-|-$/g, "")
		.slice(0, 80);
}

let bucketEnsurePromise: Promise<void> | null = null;
async function ensureScreenshotBucket() {
	if (bucketEnsurePromise) return bucketEnsurePromise;

	bucketEnsurePromise = (async () => {
		const supabase = getSupabaseServer();
		const bucket = config.DEPLOYMENT_SCREENSHOT_BUCKET.trim() || "deployment-screenshots";
		try {
			await supabase.storage.createBucket(bucket, { public: true });
		} catch (err: unknown) {
			// Bucket already exists (idempotency). Supabase error message can vary.
			const msg = String((err as { message?: unknown })?.message ?? err);
			if (!/exists/i.test(msg) && !/already/i.test(msg)) {
				throw err;
			}
		}
	})();

	return bucketEnsurePromise;
}

export async function captureDeploymentScreenshotAndUpload(opts: {
	url: string;
	ownerID: string;
	repoName: string;
	serviceName: string;
}): Promise<string> {
	const { url, ownerID, repoName, serviceName } = opts;
	const targetUrl = (url || "").trim();
	if (!targetUrl) throw new Error("captureDeploymentScreenshotAndUpload: missing url");

	const bucket = config.DEPLOYMENT_SCREENSHOT_BUCKET.trim() || "deployment-screenshots";
	await ensureScreenshotBucket();

	// Capture screenshot using a runtime-compatible Chromium launcher.
	const browser = await launchChromiumForScreenshot();
	try {
		const context = await browser.newContext({
			ignoreHTTPSErrors: true,
			viewport: { width: 1280, height: 720 },
		});

		const page = await context.newPage();

		// Some apps use long-polling/websocket and never reach "networkidle".
		await page.goto(targetUrl, {
			waitUntil: "domcontentloaded",
			timeout: 45_000,
		});
		try {
			await page.waitForLoadState("networkidle", { timeout: 10_000 });
		} catch {
			// Non-fatal; just means the page kept connections open.
		}

		// Small delay to let client-side UI settle (most deployed UIs hydrate quickly).
		await page.waitForTimeout(2500);

		const pngBuffer = (await page.screenshot({ type: "png", fullPage: false })) as Buffer;
		await context.close();

		const objectKey = `${sanitizePathSegment(ownerID)}/${sanitizePathSegment(repoName)}/${sanitizePathSegment(
			serviceName
		)}/${Date.now()}.png`;

		const supabase = getSupabaseServer();
		// Use Buffer directly to avoid TS BlobPart incompatibilities in Node typings.
		const uploadBody = pngBuffer;

		const { error: uploadError } = await supabase.storage
			.from(bucket)
			.upload(objectKey, uploadBody, { contentType: "image/png", upsert: true });

		if (uploadError) throw uploadError;

		const { data } = supabase.storage.from(bucket).getPublicUrl(objectKey);
		return data.publicUrl;
	} finally {
		await browser.close().catch(() => {});
	}
}

