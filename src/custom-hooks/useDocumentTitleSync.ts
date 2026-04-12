/**
 * useDocumentTitleSync
 * Manages document title and favicon based on deployment state
 */

import { useEffect, useRef } from "react";

type DeploymentWorkspaceState = "idle" | "running" | "success" | "error";

interface UseDocumentTitleSyncProps {
	repoName: string | undefined;
	workspaceState: DeploymentWorkspaceState;
}

const SUCCESS_DISPLAY_DURATION = 7000; // 7 seconds

function resolveDisplayAssets(
	repoName: string | undefined,
	displayState: DeploymentWorkspaceState,
	defaultIconHref: string
) {
	const pageTitleLabel = repoName ?? "Smart Deploy";
	const title =
		displayState === "running"
			? `${pageTitleLabel} - Deploying...`
			: displayState === "success"
				? `${pageTitleLabel} - Deployment succeeded`
				: displayState === "error"
					? `${pageTitleLabel} - Deployment failed`
					: pageTitleLabel === "Smart Deploy"
						? "Smart Deploy"
						: `${pageTitleLabel} - Smart Deploy`;

	const iconHref =
		displayState === "running"
			? "/icons/favicon-deploying.svg"
			: displayState === "success"
				? "/icons/favicon-success.svg"
				: displayState === "error"
					? "/icons/favicon-failed.svg"
					: defaultIconHref;

	return { title, iconHref };
}

export function useDocumentTitleSync({ repoName, workspaceState }: UseDocumentTitleSyncProps) {
	const initialTitleRef = useRef<string | null>(null);
	const initialIconHrefRef = useRef<string | null>(null);

	useEffect(() => {
		if (typeof document === "undefined") return undefined;

		if (initialTitleRef.current === null) {
			initialTitleRef.current = document.title;
		}

		let iconLink = document.querySelector<HTMLLinkElement>("link[rel~='icon']");
		if (!iconLink) {
			iconLink = document.createElement("link");
			iconLink.setAttribute("rel", "icon");
			document.head.appendChild(iconLink);
		}

		if (initialIconHrefRef.current === null) {
			initialIconHrefRef.current = iconLink.getAttribute("href") ?? "/icon.svg";
		}

		const applyState = (displayState: DeploymentWorkspaceState) => {
			const defaultIconHref = initialIconHrefRef.current ?? "/icon.svg";
			const { title, iconHref } = resolveDisplayAssets(repoName, displayState, defaultIconHref);
			document.title = title;
			if (iconLink.getAttribute("href") !== iconHref) {
				iconLink.setAttribute("href", iconHref);
			}
		};

		applyState(workspaceState);

		let successTimeout: ReturnType<typeof setTimeout> | null = null;
		if (workspaceState === "success") {
			successTimeout = setTimeout(() => {
				applyState("idle");
			}, SUCCESS_DISPLAY_DURATION);
		}

		return () => {
			if (successTimeout) {
				clearTimeout(successTimeout);
			}
			if (initialTitleRef.current) {
				document.title = initialTitleRef.current;
			}
			if (initialIconHrefRef.current) {
				iconLink.setAttribute("href", initialIconHrefRef.current);
			}
		};
	}, [repoName, workspaceState]);
}
