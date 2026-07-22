import { expect, test, type Page } from "@playwright/test";

async function expectNoHorizontalOverflow(page: Page) {
	const hasOverflow = await page.evaluate(() => {
		const root = document.documentElement;
		return root.scrollWidth > root.clientWidth + 1;
	});

	expect(hasOverflow).toBe(false);
}

test("landing page renders interactive v2 hero and has no horizontal overflow", async ({ page }) => {
	await page.goto("/");

	const heroHeading = page.getByRole("heading", { level: 1, name: /Point, preview, deploy/i });
	await expect(heroHeading).toBeVisible();
	await expect(page.getByTestId("landing-crawlable-content")).toBeAttached();
	await expect(page.getByTestId("landing-v2-workspace")).toBeVisible();
	await expect(page.getByTestId("landing-v2-run-analysis")).toBeVisible();
	await expect(page.getByRole("banner").getByRole("link", { name: "Docs" })).toBeVisible();
	await expect(page.getByRole("banner").getByRole("link", { name: "Join the waitlist" })).toHaveAttribute(
		"href",
		"/auth"
	);
	await expect(page.getByRole("navigation", { name: "Footer" }).getByRole("link", { name: "Changelog" })).toBeVisible();
	await expectNoHorizontalOverflow(page);

	// Drive the demo: run analysis, advance to the blueprint, then approve & deploy.
	await page.getByTestId("landing-v2-run-analysis").click();
	await page.getByTestId("landing-v2-continue-scan").click();
	await expect(page.getByTestId("landing-v2-approve-blueprint")).toBeVisible({ timeout: 15000 });
	await page.getByTestId("landing-v2-approve-blueprint").click();
	await expect(page.getByTestId("landing-v2-replay")).toBeVisible({ timeout: 15000 });
	await expect(page.getByTestId("landing-v2-final-cta")).toHaveAttribute("href", "/auth");
	await expectNoHorizontalOverflow(page);

	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto("/");

	await expect(heroHeading).toBeVisible();
	await expect(page.getByTestId("landing-v2-run-analysis")).toBeVisible();
	await expectNoHorizontalOverflow(page);
});

test("landing page replays a shared repo from the ?repo query param", async ({ page }) => {
	await page.goto("/?repo=facebook/react");

	await expect(page.getByTestId("landing-v2-workspace")).toBeVisible();
	await expect(page.getByText("github.com/facebook/react").first()).toBeVisible();
	await expectNoHorizontalOverflow(page);
});

test("docs page renders key sections and has no horizontal overflow on desktop/mobile", async ({ page }) => {
	await page.goto("/docs");

	await expect(page.getByRole("heading", { name: "Repository docs" })).toBeVisible();
	await expect(page.getByRole("heading", { name: "Smart Deploy", exact: true })).toBeVisible();
	await expect(page.getByRole("heading", { name: "Highlights" })).toBeVisible();
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
