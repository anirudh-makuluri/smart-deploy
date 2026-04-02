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

export function useDocumentTitleSync({ repoName, workspaceState }: UseDocumentTitleSyncProps) {
	const initialTitleRef = useRef<string | null>(null);
	const initialIconHrefRef = useRef<string | null>(null);

	// Update document title
	useEffect(() => {
		if (typeof document === "undefined") return;

		if (initialTitleRef.current === null) {
			initialTitleRef.current = document.title;
		}

		const pageTitleLabel = repoName ?? "Smart Deploy";
		const statusTitle =
			workspaceState === "running"
				? `${pageTitleLabel} - Deploying...`
				: workspaceState === "success"
					? `${pageTitleLabel} - Deployment succeeded`
					: workspaceState === "error"
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
	}, [repoName, workspaceState]);

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
			workspaceState === "running"
				? "/icons/favicon-deploying.svg"
				: workspaceState === "success"
					? "/icons/favicon-success.svg"
					: workspaceState === "error"
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
	}, [workspaceState]);
}
