import { Suspense } from "react";
import RepoPageClient from "./RepoPageClient";

type PageProps = {
	params: Promise<{ owner: string; repo: string }>;
};

export default async function RepoPage({ params }: PageProps) {
	const { owner, repo: repoName } = await params;
	return (
		<Suspense fallback={null}>
			<RepoPageClient owner={owner} repoName={repoName} />
		</Suspense>
	);
}
