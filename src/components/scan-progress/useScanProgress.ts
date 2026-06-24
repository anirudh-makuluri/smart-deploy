import * as React from "react";
import { useEffect, useEffectEvent, useReducer, useRef } from "react";
import type { SDArtifactsResponse } from "@/app/types";
import { normalizeScanResultPayload } from "@/lib/scanResultNormalization";
import { fetchLatestCommit } from "@/lib/graphqlClient";
import {
	initialScanProgressState,
	scanProgressReducer,
	type ScanProgressAction,
} from "@/components/scan-progress/scanProgressState";
import { formatStructuredError, githubOwnerRepoFromUrl } from "@/components/scan-progress/scanProgressUtils";

type UseScanProgressParams = {
	repoUrl: string;
	packagePath: string;
	branch: string;
	repoName: string;
	serviceName: string;
	onComplete: (data: SDArtifactsResponse) => void;
};

export function useScanProgress({
	repoUrl,
	packagePath,
	branch,
	repoName,
	serviceName,
	onComplete,
}: UseScanProgressParams) {
	const [state, dispatch] = useReducer(scanProgressReducer, initialScanProgressState);
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

	const appendLog = useEffectEvent((msg: string, actionDispatch: React.Dispatch<ScanProgressAction>) => {
		actionDispatch({
			type: "append_log",
			message: `[${new Date().toLocaleTimeString()}] ${msg}`,
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

			if (field === "event") {
				eventType = value;
			} else if (field === "data") {
				dataStr += (dataStr ? "\n" : "") + value;
			}
		}

		if (dataStr) {
			try {
				const data = JSON.parse(dataStr);
				if (eventType === "progress") {
					const { node, status } = data;
					appendLog(`event: progress data: {"node": "${node}", "status": "${status}"}`, dispatch);

					if (status === "started") {
						dispatch({ type: "set_active_node", node });
					} else if (status === "completed") {
						dispatch({ type: "complete_node", node });
					} else if (status === "error") {
						dispatch({ type: "set_failed_node", node });
						appendLog(
							`error: ${formatStructuredError(data.message || data.detail || "Unknown error in node " + node)}`,
							dispatch
						);
					}
				} else if (eventType === "complete") {
					appendLog("event: analysis complete", dispatch);
					dispatch({ type: "set_progress", value: 100 });
					const normalized = normalizeScanResultPayload(data);
					if (!normalized) {
						appendLog("error: Unable to parse complete scan payload", dispatch);
						dispatch({ type: "set_failed_node", node: activeNodeRef.current });
						return;
					}
					try {
						const unitCount = normalized.deploy_units.length;
						void fetch("/api/artifacts/generation", {
							method: "POST",
							headers: { "Content-Type": "application/json" },
							body: JSON.stringify({
								source: "scan",
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
					console.error("SSE Error event received:", errorMsg);
					appendLog(`error: ${errorMsg}`, dispatch);
					dispatch({ type: "set_failed_node", node: activeNodeRef.current });
				}
			} catch (e) {
				console.error("Failed to parse SSE JSON data", e, dataStr);
				appendLog(`error: JSON parse failed for ${eventType}`, dispatch);
			}
		} else {
			console.warn("Message has no data field", message);
		}
	});

	const startStream = useEffectEvent(async (signal: AbortSignal) => {
		try {
			const parsed = githubOwnerRepoFromUrl(repoUrl);
			if (!parsed) {
				throw new Error("Could not parse owner/repo from repository URL");
			}
			const head = await fetchLatestCommit(parsed.owner, parsed.repo, branch);
			const commitSha = head?.sha?.trim() || "";
			if (!commitSha) {
				throw new Error("Could not resolve commit SHA for this branch");
			}

			const response = await fetch("/api/scan/stream", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					repo_url: repoUrl,
					package_path: packagePath,
					commit_sha: commitSha,
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
						code?: string;
						reason?: string;
						suggested_package_paths?: unknown;
					};
					if (parsed.code === "scope_required") {
						const paths = Array.isArray(parsed.suggested_package_paths)
							? parsed.suggested_package_paths.filter((x): x is string => typeof x === "string")
							: [];
						const reason =
							typeof parsed.reason === "string" && parsed.reason.trim()
								? parsed.reason.trim()
								: "Repository scope is too broad for root analysis. Specify package_path.";
						throw new Error(
							paths.length ? `${reason} Suggested: ${paths.slice(0, 20).join(", ")}` : reason
						);
					}
					const detailObj = Array.isArray(parsed.detail)
						? (parsed.detail[0] as { reason?: string; code?: string } | undefined)
						: (parsed.detail as { reason?: string; code?: string } | undefined);
					if (detailObj && typeof detailObj === "object") {
						throw new Error(detailObj.reason || detailObj.code || "Failed to start analysis stream");
					}
					throw new Error(
						(typeof parsed?.detail === "string" && parsed.detail) ||
							parsed?.message ||
							parsed?.error ||
							`Failed to start analysis stream (${response.status})`
					);
				} catch {
					throw new Error(errText || `Failed to start analysis stream (${response.status})`);
				}
			}

			if (!response.body) {
				throw new Error("No response body");
			}

			const reader = response.body.getReader();
			const decoder = new TextDecoder();
			let buffer = "";

			appendLog("info: connected to sd-artifacts analyze stream", dispatch);

			const readStream = async (): Promise<void> => {
				const { done, value } = await reader.read();

				if (value) {
					const chunk = decoder.decode(value, { stream: true });
					buffer += chunk;

					const messages = buffer.split("\n\n");
					buffer = messages.pop() || "";

					for (const msg of messages) {
						if (msg.trim()) {
							processMessage(msg);
						}
					}
				}

				if (done) {
					if (buffer.trim()) {
						processMessage(buffer);
					}
					return;
				}

				await readStream();
			};

			await readStream();
		} catch (error: unknown) {
			if (!(error instanceof Error) || error.name !== "AbortError") {
				console.error("Stream error:", error);
				const message = error instanceof Error ? error.message : String(error);
				dispatch({
					type: "append_log",
					message: `[${new Date().toLocaleTimeString()}] error: ${message}`,
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
	}, [repoUrl, packagePath, branch, repoName, serviceName]);

	return { state, logsEndRef };
}
