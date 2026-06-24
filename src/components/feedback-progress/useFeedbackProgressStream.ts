import { type Dispatch, useEffect, useEffectEvent, useReducer, useRef } from "react";
import type { SDArtifactsResponse } from "@/app/types";
import { FEEDBACK_PROGRESS_NODES } from "@/components/feedback-progress/feedbackProgressConstants";
import { formatStructuredError } from "@/components/feedback-progress/formatStructuredError";
import {
	feedbackProgressReducer,
	initialFeedbackProgressState,
	type FeedbackProgressAction,
} from "@/components/feedback-progress/feedbackProgressState";
import { normalizeScanResultPayload } from "@/lib/scanResultNormalization";
import type { FeedbackProgressPayload } from "@/components/feedback-progress/types";

type UseFeedbackProgressStreamArgs = {
	payload: FeedbackProgressPayload;
	repoName: string;
	serviceName: string;
	onComplete: (data: SDArtifactsResponse) => void;
};

export function useFeedbackProgressStream({
	payload,
	repoName,
	serviceName,
	onComplete,
}: UseFeedbackProgressStreamArgs) {
	const { repoUrl, commitSha, packagePath, feedback, failureSummary, failureLogs, failedArtifactScope } = payload;
	const [state, dispatch] = useReducer(feedbackProgressReducer, initialFeedbackProgressState);
	const logsEndRef = useRef<HTMLDivElement>(null);
	const abortControllerRef = useRef<AbortController | null>(null);
	const activeNodeRef = useRef(state.activeNode);
	const onCompleteRef = useRef(onComplete);

	useEffect(() => {
		activeNodeRef.current = state.activeNode;
	}, [state.activeNode]);

	useEffect(() => {
		onCompleteRef.current = onComplete;
	}, [onComplete]);

	const appendLog = useEffectEvent((msg: string, actionDispatch: Dispatch<FeedbackProgressAction>) => {
		actionDispatch({
			type: "append_log",
			message: `[${new Date().toLocaleTimeString()}] ${msg}`,
		});
		window.requestAnimationFrame(() => {
			logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
		});
	});

	const processMessage = useEffectEvent((message: string) => {
		const lines = message.split(/\r?\n/);
		let eventType = "message";
		let dataStr = "";

		for (const line of lines) {
			if (!line.trim()) continue;
			const colonIndex = line.indexOf(":");
			if (colonIndex === -1) continue;
			const field = line.slice(0, colonIndex).trim();
			const value = line.slice(colonIndex + 1).replace(/^ /, "");
			if (field === "event") eventType = value;
			else if (field === "data") dataStr += (dataStr ? "\n" : "") + value;
		}

		if (dataStr) {
			try {
				const data = JSON.parse(dataStr);
				if (eventType === "progress") {
					const { node, status } = data;
					appendLog(`event: progress data: {"node": "${node}", "status": "${status}"}`, dispatch);
					if (status === "started") {
						dispatch({ type: "set_active_node", value: node });
					} else if (status === "completed") {
						const nodeIndex = FEEDBACK_PROGRESS_NODES.findIndex((n) => n.id === node);
						if (nodeIndex >= 0) {
							dispatch({
								type: "complete_node",
								node,
								progress: Math.round(((nodeIndex + 1) / FEEDBACK_PROGRESS_NODES.length) * 100),
							});
						} else {
							dispatch({ type: "complete_node", node });
							if (typeof node === "string" && node) {
								dispatch({ type: "increment_progress", amount: 5 });
							}
						}
					} else if (status === "error") {
						dispatch({ type: "set_failed_node", value: node });
						appendLog(
							`error: ${formatStructuredError(data.message || data.detail || "Unknown error in node " + node)}`,
							dispatch
						);
					}
				} else if (eventType === "complete") {
					appendLog("event: feedback complete", dispatch);
					dispatch({ type: "set_progress", value: 100 });
					const normalized = normalizeScanResultPayload(data);
					if (!normalized) {
						appendLog("error: Unable to parse feedback payload", dispatch);
						dispatch({ type: "set_failed_node", value: activeNodeRef.current });
						return;
					}
					try {
						const unitCount = normalized.deploy_units.length;
						void fetch("/api/artifacts/generation", {
							method: "POST",
							headers: { "Content-Type": "application/json" },
							body: JSON.stringify({
								source: "feedback",
								repoName,
								serviceName,
								dockerfilesCount: unitCount,
								hasExistingDockerfiles: normalized.deploy_units.some((u) => u.type === "existing_docker"),
								hasExistingCompose: false,
								hasCompose: normalized.deploy_shape === "multi",
								hasNginx: false,
								analyzeBuildStatus: normalized.build_status,
							}),
						});
					} catch {
						// ignore
					}
					onCompleteRef.current(normalized as SDArtifactsResponse);
				} else if (eventType === "error") {
					const errorMsg = formatStructuredError(data.detail || data.message || data.error || "Unknown error");
					appendLog(`error: ${errorMsg}`, dispatch);
					dispatch({ type: "set_failed_node", value: activeNodeRef.current });
				}
			} catch (e) {
				console.error("Failed to parse SSE JSON data", e, dataStr);
				appendLog(`error: JSON parse failed for ${eventType}`, dispatch);
			}
		}
	});

	const startStream = useEffectEvent(async (signal: AbortSignal) => {
		try {
			if (!commitSha) {
				throw new Error("Missing commit_sha (required for feedback remediation)");
			}
			const response = await fetch("/api/feedback/stream", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					repo_url: repoUrl,
					commit_sha: commitSha,
					...(packagePath && { package_path: packagePath }),
					feedback,
					...(failureSummary && { failure_summary: failureSummary }),
					...(failureLogs && { failure_logs: failureLogs }),
					...(failedArtifactScope && { failed_artifact_scope: failedArtifactScope }),
				}),
				signal,
			});

			if (!response.ok) {
				const errText = await response.text();
				try {
					const parsed = JSON.parse(errText) as {
						detail?: unknown;
						message?: string;
						error?: string;
						details?: string;
					};
					const detailObj = Array.isArray(parsed.detail)
						? (parsed.detail[0] as { reason?: string; code?: string } | undefined)
						: (parsed.detail as { reason?: string; code?: string } | undefined);
					if (detailObj && typeof detailObj === "object") {
						throw new Error(detailObj.reason || detailObj.code || "Failed to start feedback stream");
					}
					throw new Error(
						(typeof parsed?.detail === "string" && parsed.detail) ||
						parsed?.details ||
						parsed?.message ||
						parsed?.error ||
						`Failed to start feedback stream (${response.status})`
					);
				} catch {
					throw new Error(errText || `Failed to start feedback stream (${response.status})`);
				}
			}

			if (!response.body) {
				throw new Error("No response body");
			}

			const reader = response.body.getReader();
			const decoder = new TextDecoder();
			let buffer = "";

			appendLog("info: connected to sd-artifacts feedback stream", dispatch);

			const readStream = async (): Promise<void> => {
				const { done, value } = await reader.read();
				if (value) {
					const chunk = decoder.decode(value, { stream: true });
					buffer += chunk;
					const messages = buffer.split("\n\n");
					buffer = messages.pop() || "";
					for (const msg of messages) {
						if (msg.trim()) processMessage(msg);
					}
				}
				if (done) {
					if (buffer.trim()) processMessage(buffer);
					return;
				}
				await readStream();
			};

			await readStream();
		} catch (error: unknown) {
			if (error instanceof Error && error.name !== "AbortError") {
				console.error("Feedback stream error:", error);
				dispatch({
					type: "append_log",
					message: `[${new Date().toLocaleTimeString()}] error: ${error.message}`,
				});
			}
		}
	});

	useEffect(() => {
		abortControllerRef.current = new AbortController();
		startStream(abortControllerRef.current.signal);
		return () => {
			if (abortControllerRef.current) {
				abortControllerRef.current.abort();
			}
		};
	}, [repoUrl, commitSha, packagePath, feedback, failureSummary, failureLogs, failedArtifactScope, repoName, serviceName]);

	return { state, logsEndRef };
}
