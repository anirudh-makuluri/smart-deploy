import { describe, expect, it, vi, beforeEach } from "vitest";

const runRedeployViaSsmMock = vi.fn();
const runCommandLiveWithWebSocketMock = vi.fn();

vi.mock("@/lib/aws/ec2SsmHelpers", async () => {
	const actual = await vi.importActual<typeof import("@/lib/aws/ec2SsmHelpers")>("@/lib/aws/ec2SsmHelpers");
	return {
		...actual,
		runRedeployViaSsm: (...args: unknown[]) => runRedeployViaSsmMock(...args),
	};
});

vi.mock("@/server-helper", () => ({
	runCommandLiveWithWebSocket: (...args: unknown[]) => runCommandLiveWithWebSocketMock(...args),
}));

describe("EC2 diagnostics pipeline", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("collects docker logs with tail=300 before curl checks", async () => {
		const events: string[] = [];
		runRedeployViaSsmMock.mockImplementation(async (params: any) => {
			events.push("docker_logs");
			expect(params.script).toContain("docker logs --tail 300 smartdeploy-app");
			return { success: true, output: "ok" };
		});
		runCommandLiveWithWebSocketMock.mockImplementation(async () => {
			events.push("curl");
			return "200";
		});

		const { detectRespondingPort } = await import("@/lib/aws/handleEC2");
		const logs: string[] = [];
		const send = (msg: string) => logs.push(msg);
		const port = await detectRespondingPort(
			"1.2.3.4",
			[{ name: "app", dir: ".", port: 8080 }],
			"i-123",
			"us-west-2",
			{},
			send as any
		);

		expect(port).toBe(80);
		expect(events[0]).toBe("docker_logs");
		expect(events[1]).toBe("curl");
		expect(logs).toContain("diagnostics:docker_logs:start container=smartdeploy-app tail=300");
		expect(logs).toContain("diagnostics:docker_logs:end");
		expect(logs).toContain("diagnostics:curl:start");
		expect(logs).toContain("diagnostics:curl:end");
	});

	it("uses missing-container guardrail and still continues to curl checks", async () => {
		runRedeployViaSsmMock.mockResolvedValue({ success: true, output: "ok" });
		runCommandLiveWithWebSocketMock.mockResolvedValue("404");

		const { runPreCurlDiagnostics } = await import("@/lib/aws/handleEC2");
		const send = vi.fn();
		await runPreCurlDiagnostics({
			instanceId: "i-456",
			region: "us-west-2",
			send,
			containerName: "smartdeploy-app",
			tail: 300,
		});

		expect(runRedeployViaSsmMock).toHaveBeenCalledTimes(1);
		const script = runRedeployViaSsmMock.mock.calls[0][0].script as string;
		expect(script).toContain("docker ps -a --format '{{.Names}}' | grep -Fxq 'smartdeploy-app'");
		expect(script).toContain("container 'smartdeploy-app' not found; continuing to curl checks");
	});
});
