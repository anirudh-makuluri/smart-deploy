import { describe, expect, it } from "vitest";
import {
	broadcastLog,
	createEntry,
	getSocketSnapshot,
	setStatus,
} from "@/lib/deployLogsStore";

describe("deployLogsStore", () => {
	it("does not replay completed deployment logs as an active snapshot", () => {
		const userID = "user-completed-run";
		const repoName = "repo-completed-run";
		const serviceName = "web-completed-run";

		createEntry(userID, repoName, serviceName);
		broadcastLog(userID, repoName, serviceName, "build", "Build complete");
		setStatus(userID, repoName, serviceName, "success");

		expect(getSocketSnapshot(userID, repoName, serviceName)).toBeNull();
	});
});
