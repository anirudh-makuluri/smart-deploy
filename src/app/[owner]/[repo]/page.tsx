import { ReactNode } from "react";
import RepoPageClient from "./RepoPageClient";

type PageProps = {
	params: Promise<{ owner: string; repo: string }>;
};

export default async function RepoPage({ params }: PageProps) {
	const { owner, repo } = await params;
	return <RepoPageClient owner={owner} repo={repo} />;
}
