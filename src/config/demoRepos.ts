export type DemoRepoConfigEntry = {
	demoRepoKey: string;
	owner: string;
	repo: string;
	branch: string;
	commitSha?: string;
	title?: string;
	description?: string;
};

export const demoRepos: DemoRepoConfigEntry[] = [
	{
		demoRepoKey: "chatify",
		owner: "anirudh-makuluri",
		repo: "chatify",
		branch: "main",
		commitSha: "5d4af71f1630a24d6ac28bbec15a05b48994f146",
		description: "Pinned demo app (turborepo Next.js).",
	},
	{
		demoRepoKey: "lexiguess-next",
		owner: "anirudh-makuluri",
		repo: "lexiguess-next",
		branch: "main",
		commitSha: "489a4bec16aa47213dd8ff216a09b642a28d50a5",
		description: "Pinned demo app (single-app Next.js).",
	},
];
