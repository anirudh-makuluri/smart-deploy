import { expect, test } from "@playwright/test";

test("homepage shell loads", async ({ page }) => {
	await page.goto("/");
	await expect(page.locator("body")).toBeVisible();
});

test("unhappy API path returns visible error payload", async ({ page }) => {
	await page.route("**/api/deployment-preview-screenshot", async (route) => {
		await route.fulfill({
			status: 500,
			contentType: "application/json",
			body: JSON.stringify({ error: "mocked-failure" }),
		});
	});

	await page.goto("/");
	const error = await page.evaluate(async () => {
		const res = await fetch("/api/deployment-preview-screenshot", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ repoName: "repo", serviceName: "svc" }),
		});
		const body = await res.json();
		return body.error;
	});
	expect(error).toBe("mocked-failure");
});
