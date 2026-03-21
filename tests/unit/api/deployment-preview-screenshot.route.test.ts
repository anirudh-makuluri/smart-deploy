import { beforeEach, describe, expect, it, vi } from "vitest";

const getServerSessionMock = vi.fn();
const captureMock = vi.fn();
const patchDeploymentDataMock = vi.fn();

let maybeSingleMock = vi.fn();

vi.mock("next-auth", () => ({
	getServerSession: () => getServerSessionMock(),
}));

vi.mock("@/lib/supabaseServer", () => ({
	getSupabaseServer: () => ({
		from: () => ({
			select: () => ({
				eq: () => ({
					eq: () => ({
						eq: () => ({
							order: () => ({
								limit: () => ({
									maybeSingle: () => maybeSingleMock(),
								}),
							}),
						}),
					}),
				}),
			}),
		}),
	}),
}));

vi.mock("@/lib/deploymentScreenshot", () => ({
	captureDeploymentScreenshotAndUpload: (...args: unknown[]) => captureMock(...args),
}));

vi.mock("@/db-helper", () => ({
	dbHelper: {
		patchDeploymentData: (...args: unknown[]) => patchDeploymentDataMock(...args),
	},
}));

describe("POST /api/deployment-preview-screenshot", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns 401 when user session is missing", async () => {
		getServerSessionMock.mockResolvedValue(undefined);
		const { POST } = await import("@/app/api/deployment-preview-screenshot/route");
		const res = await POST(new Request("http://localhost", {
			method: "POST",
			body: JSON.stringify({ repoName: "repo", serviceName: "svc" }),
		}) as any);
		expect(res.status).toBe(401);
	});

	it("returns cached screenshot URL when already present", async () => {
		getServerSessionMock.mockResolvedValue({ userID: "u-1" });
		maybeSingleMock.mockResolvedValue({
			data: { id: "dep-1", data: { screenshot_url: "https://cdn.example.com/existing.png" }, status: "running" },
			error: null,
		});
		const { POST } = await import("@/app/api/deployment-preview-screenshot/route");
		const res = await POST(new Request("http://localhost", {
			method: "POST",
			body: JSON.stringify({ repoName: "repo", serviceName: "svc" }),
		}) as any);
		const body = await res.json();
		expect(res.status).toBe(200);
		expect(body.screenshotUrl).toBe("https://cdn.example.com/existing.png");
		expect(captureMock).not.toHaveBeenCalled();
	});

	it("captures and patches screenshot for live deployment URL", async () => {
		getServerSessionMock.mockResolvedValue({ userID: "u-1" });
		maybeSingleMock.mockResolvedValue({
			data: { id: "dep-1", data: { deployUrl: "https://app.example.com" }, status: "running" },
			error: null,
		});
		captureMock.mockResolvedValue("https://cdn.example.com/new.png");
		patchDeploymentDataMock.mockResolvedValue({ data: { ok: true } });

		const { POST } = await import("@/app/api/deployment-preview-screenshot/route");
		const res = await POST(new Request("http://localhost", {
			method: "POST",
			body: JSON.stringify({ repoName: "repo", serviceName: "svc" }),
		}) as any);
		const body = await res.json();
		expect(res.status).toBe(200);
		expect(body.screenshotUrl).toBe("https://cdn.example.com/new.png");
		expect( patchDeploymentDataMock).toHaveBeenCalledWith("repo", "svc", "u-1", {
			screenshot_url: "https://cdn.example.com/new.png",
		});
	});

	it("returns 400 when no deploy URL/custom URL exists", async () => {
		getServerSessionMock.mockResolvedValue({ userID: "u-1" });
		maybeSingleMock.mockResolvedValue({
			data: { id: "dep-1", data: {}, status: "running" },
			error: null,
		});
		const { POST } = await import("@/app/api/deployment-preview-screenshot/route");
		const res = await POST(new Request("http://localhost", {
			method: "POST",
			body: JSON.stringify({ repoName: "repo", serviceName: "svc" }),
		}) as any);
		expect(res.status).toBe(400);
	});
});
