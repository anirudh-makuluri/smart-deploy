import { expect, test } from "@playwright/test";

async function expectNoHorizontalOverflow(page: Parameters<typeof test>[0]["page"]) {
	const hasOverflow = await page.evaluate(() => {
		const root = document.documentElement;
		return root.scrollWidth > root.clientWidth + 1;
	});

	expect(hasOverflow).toBe(false);
}

test("landing page renders premium hero and has no horizontal overflow", async ({ page }) => {
	await page.goto("/");

	await expect(page.getByRole("heading", { name: "Turn a GitHub repo into a production release without losing context." })).toBeVisible();
	await expect(page.getByRole("banner").getByRole("link", { name: "Docs" })).toBeVisible();
	await expect(page.getByRole("banner").getByRole("link", { name: "Changelog" })).toBeVisible();
	await expectNoHorizontalOverflow(page);
});

test("docs page renders key sections and has no horizontal overflow on desktop/mobile", async ({ page }) => {
	await page.goto("/docs");

	await expect(page.getByRole("heading", { name: "From repo to prod in one flow." })).toBeVisible();
	await expect(page.getByRole("heading", { name: "How it is wired" })).toBeVisible();
	await expect(page.getByText("Key characteristic")).toHaveCount(3);
	await expectNoHorizontalOverflow(page);

	await page.setViewportSize({ width: 390, height: 844 });
	await page.reload();
	await expect(page.getByRole("heading", { name: "From repo to prod in one flow." })).toBeVisible();
	await expectNoHorizontalOverflow(page);
});

test("changelog page shows milestones and has no horizontal overflow on desktop/mobile", async ({ page }) => {
	await page.goto("/changelog");

	await expect(page.getByRole("heading", { name: "Updates that made shipping faster." })).toBeVisible();
	await expect(page.getByRole("heading", { name: "Recent shipping wins" })).toBeVisible();
	await expect(page.getByText("April", { exact: false })).toHaveCount(5);
	await expectNoHorizontalOverflow(page);

	await page.setViewportSize({ width: 390, height: 844 });
	await page.reload();
	await expect(page.getByRole("heading", { name: "Updates that made shipping faster." })).toBeVisible();
	await expectNoHorizontalOverflow(page);
});
