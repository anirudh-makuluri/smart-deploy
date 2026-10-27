import type { repoType } from "@/app/types";

export function makeRepo(overrides: Partial<repoType> = {}): repoType {
	return {
		id: "repo-1",
		name: "shop",
		full_name: "acme/shop",
		html_url: "https://github.com/acme/shop",
		language: "TypeScript",
		languages_url: "https://api.github.com/repos/acme/shop/languages",
		created_at: "2026-06-24T00:00:00.000Z",
		updated_at: "2026-06-24T00:00:00.000Z",
		pushed_at: "2026-06-24T00:00:00.000Z",
		default_branch: "main",
		private: false,
		visibility: "public",
		owner: { login: "acme" },
		latest_commit: null,
		branches: [],
		...overrides,
	};
}
