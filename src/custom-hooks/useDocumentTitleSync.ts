/**
 * useDocumentTitleSync
 * Manages document title and favicon based on deployment state
 */

import { useEffect, useRef, useState } from "react";

type DeploymentWorkspaceState = "idle" | "running" | "success" | "error";

interface UseDocumentTitleSyncProps {
	repoName: string | undefined;
	workspaceState: DeploymentWorkspaceState;
}

const SUCCESS_DISPLAY_DURATION = 7000; // 7 seconds

export function useDocumentTitleSync({ repoName, workspaceState }: UseDocumentTitleSyncProps) {
	const initialTitleRef = useRef<string | null>(null);
	const initialIconHrefRef = useRef<string | null>(null);
	const [displayState, setDisplayState] = useState<DeploymentWorkspaceState>(workspaceState);

	// Handle success state timeout - auto-revert after duration
	useEffect(() => {
		if (workspaceState === "success") {
			setDisplayState("success");
			const timer = setTimeout(() => {
				setDisplayState("idle");
			}, SUCCESS_DISPLAY_DURATION);
			return () => clearTimeout(timer);
		} else {
			setDisplayState(workspaceState);
		}
	}, [workspaceState]);

	// Update document title
	useEffect(() => {
		if (typeof document === "undefined") return;

		if (initialTitleRef.current === null) {
			initialTitleRef.current = document.title;
		}

		const pageTitleLabel = repoName ?? "Smart Deploy";
		const statusTitle =
			displayState === "running"
				? `${pageTitleLabel} - Deploying...`
				: displayState === "success"
					? `${pageTitleLabel} - Deployment succeeded`
					: displayState === "error"
						? `${pageTitleLabel} - Deployment failed`
						: pageTitleLabel === "Smart Deploy"
							? "Smart Deploy"
							: `${pageTitleLabel} - Smart Deploy`;

		document.title = statusTitle;

		return () => {
			if (initialTitleRef.current) {
				document.title = initialTitleRef.current;
			}
		};
	}, [repoName, displayState]);

	// Update favicon
	useEffect(() => {
		if (typeof document === "undefined") return;

		let iconLink = document.querySelector<HTMLLinkElement>("link[rel~='icon']");
		if (!iconLink) {
			iconLink = document.createElement("link");
			iconLink.setAttribute("rel", "icon");
			document.head.appendChild(iconLink);
		}

		if (initialIconHrefRef.current === null) {
			initialIconHrefRef.current = iconLink.getAttribute("href") ?? "/icon.svg";
		}

		const targetHref =
			displayState === "running"
				? "/icons/favicon-deploying.svg"
				: displayState === "success"
					? "/icons/favicon-success.svg"
					: displayState === "error"
						? "/icons/favicon-failed.svg"
						: initialIconHrefRef.current;

		if (iconLink.getAttribute("href") !== targetHref) {
			iconLink.setAttribute("href", targetHref);
		}

		return () => {
			if (iconLink && initialIconHrefRef.current) {
				iconLink.setAttribute("href", initialIconHrefRef.current);
			}
		};
	}, [displayState]);
}
