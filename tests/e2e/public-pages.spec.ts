import { expect, test, type Page } from "@playwright/test";

async function expectNoHorizontalOverflow(page: Page) {
	const hasOverflow = await page.evaluate(() => {
		const root = document.documentElement;
		return root.scrollWidth > root.clientWidth + 1;
	});

	expect(hasOverflow).toBe(false);
}

test("landing page renders premium hero and has no horizontal overflow", async ({ page }) => {
	await page.goto("/");

	const heroHeading = page.locator("main h1").first();
	await expect(heroHeading).toBeVisible();
	await expect(heroHeading).toContainText("Deploy your");
	await expect(heroHeading).toContainText("without the black box.");
	await expect(page.getByRole("banner").getByRole("link", { name: "Docs" })).toBeVisible();
	await expect(page.getByRole("navigation", { name: "Footer" }).getByRole("link", { name: "Changelog" })).toBeVisible();
	await expect(page.getByTestId("landing-typed-line")).toHaveCSS("display", "inline-block");
	await expectNoHorizontalOverflow(page);

	await page.setViewportSize({ width: 390, height: 844 });
	await page.reload();

	await expect(heroHeading).toBeVisible();
	await expect(page.getByTestId("landing-typed-line")).toHaveCSS("display", "block");

	const prefixBox = await page.getByTestId("landing-hero-prefix").boundingBox();
	const typedLineBox = await page.getByTestId("landing-typed-line").boundingBox();
	expect(prefixBox).not.toBeNull();
	expect(typedLineBox).not.toBeNull();
	expect(typedLineBox!.y).toBeGreaterThan(prefixBox!.y);
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

test("changelog page shows release notes and has no horizontal overflow on desktop/mobile", async ({ page }) => {
	await page.goto("/changelog");

	await expect(page.getByRole("heading", { name: "What's new" })).toBeVisible();
	await expect(page.getByRole("heading", { name: "Recent highlights" })).toBeVisible();
	await expect(page.getByRole("heading", { name: "Release notes" })).toBeVisible();
	await expect(page.getByText("Commit history")).toBeVisible();
	await expectNoHorizontalOverflow(page);

	await page.setViewportSize({ width: 390, height: 844 });
	await page.reload();
	await expect(page.getByRole("heading", { name: "What's new" })).toBeVisible();
	await expectNoHorizontalOverflow(page);
});
