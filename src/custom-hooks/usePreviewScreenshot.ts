/**
 * usePreviewScreenshot
 * Manages screenshot generation and refresh with on-demand semantics
 */

import { useState, useCallback, useEffect } from "react";
import { toast } from "sonner";

interface UsePreviewScreenshotProps {
	repoName: string | undefined;
	serviceName: string | undefined;
	screenshotUrl: string | undefined;
	deploymentStatus: string;
	hasStoredLiveUrl: boolean;
	onScreenshotUpdated?: (screenshotUrl: string) => Promise<void> | void;
	onDeploymentsRefetch: (repo: string) => Promise<void>;
}

export function usePreviewScreenshot({
	repoName,
	serviceName,
	screenshotUrl,
	deploymentStatus,
	hasStoredLiveUrl,
	onScreenshotUpdated,
	onDeploymentsRefetch,
}: UsePreviewScreenshotProps) {
	const [isRefreshing, setIsRefreshing] = useState(false);
	const [lastAutoRequestKey, setLastAutoRequestKey] = useState<string | null>(null);

	const requestScreenshot = useCallback(
		async (force = false) => {
			if (!repoName || !serviceName) return;

			try {
				const res = await fetch("/api/deployment-preview-screenshot", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ repoName, serviceName, force }),
				});
				const data = await res.json();

				if (!res.ok) {
					console.error("Screenshot generation failed:", data?.error || data);
					if (force) toast.error("Failed to create preview");
					return;
				}

				if (data?.status === "skipped") {
					if (force) toast.info("Preview is currently unavailable (gateway error)");
					return;
				}

				const nextScreenshotUrl = data.screenshotUrl.trim()

				if (nextScreenshotUrl) {
					await onScreenshotUpdated?.(nextScreenshotUrl);
				}

				// Refresh deployments to reconcile local state with the server.
				await onDeploymentsRefetch(repoName);
				if (force) toast.success("Created a new preview");

				console.debug(`[Screenshot] Generated for ${repoName}/${serviceName}`);
			} catch (err) {
				console.error("Screenshot generation request error:", err);
				if (force) toast.error("Failed to create preview");
			}
		},
		[onDeploymentsRefetch, onScreenshotUpdated, repoName, serviceName]
	);

	// User manually requests a preview
	const handleRefresh = useCallback(async () => {
		if (isRefreshing) return;
		setIsRefreshing(true);
		try {
			await requestScreenshot(true);
		} finally {
			setIsRefreshing(false);
		}
	}, [isRefreshing, requestScreenshot]);

	// Auto-generate screenshot if service is running but we don't have one yet
	useEffect(() => {
		if (!repoName || !serviceName) return;
		const autoRequestKey = `${repoName}::${serviceName}`;
		if (lastAutoRequestKey === autoRequestKey) return; // Only request once per repo/service
		if (deploymentStatus !== "running") return;
		if (screenshotUrl) return; // Already have one
		if (!hasStoredLiveUrl) return; // Can't generate without a live URL

		setLastAutoRequestKey(autoRequestKey);
		console.debug(`[Screenshot] Auto-generating for ${repoName}/${serviceName}`);
		void requestScreenshot(false);
	}, [deploymentStatus, hasStoredLiveUrl, lastAutoRequestKey, repoName, requestScreenshot, screenshotUrl, serviceName]);

	return {
		isRefreshing,
		refreshScreenshot: handleRefresh,
	};
}
