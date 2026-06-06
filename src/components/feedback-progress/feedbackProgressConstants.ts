/** Matches `POST /feedback/stream` progress nodes. See `sd-artifacts-integration.md` §3.3. */
export const FEEDBACK_PROGRESS_NODES = [
	{ id: "clone_repo", label: "Clone repo", desc: "Refresh workspace at pinned commit" },
	{ id: "railpack_build_repair", label: "Build & repair", desc: "Apply feedback; Railpack build loop" },
	{ id: "finalize", label: "Finalize", desc: "Update cached analysis" },
] as const;
