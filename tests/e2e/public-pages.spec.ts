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

	await expect(page.getByRole("heading", { name: "Deploy your app without the black box." })).toBeVisible();
	await expect(page.getByRole("banner").getByRole("link", { name: "Docs" })).toBeVisible();
	await expect(page.getByRole("navigation", { name: "Footer" }).getByRole("link", { name: "Changelog" })).toBeVisible();
	await expectNoHorizontalOverflow(page);
});

test("docs page renders key sections and has no horizontal overflow on desktop/mobile", async ({ page }) => {
	await page.goto("/docs");

	await expect(page.getByRole("heading", { name: "Repository docs" })).toBeVisible();
	await expect(page.getByRole("heading", { name: "Smart Deploy", exact: true })).toBeVisible();
	await expect(page.getByRole("heading", { name: "The problem" })).toBeVisible();
	await expectNoHorizontalOverflow(page);

	await page.setViewportSize({ width: 390, height: 844 });
	await page.reload();
	await expect(page.getByRole("heading", { name: "Repository docs" })).toBeVisible();
	await expectNoHorizontalOverflow(page);
});

test("changelog page shows milestones and has no horizontal overflow on desktop/mobile", async ({ page }) => {
	await page.goto("/changelog");

	await expect(page.getByRole("heading", { name: "Commit history" })).toBeVisible();
	const dayHeadings = page.locator("h2").filter({ hasText: /^\d{4}-\d{2}-\d{2}$/ });
	await expect(dayHeadings.first()).toBeVisible();
	expect(await dayHeadings.count()).toBeGreaterThanOrEqual(3);
	await expectNoHorizontalOverflow(page);

	await page.setViewportSize({ width: 390, height: 844 });
	await page.reload();
	await expect(page.getByRole("heading", { name: "Commit history" })).toBeVisible();
	await expectNoHorizontalOverflow(page);
});
