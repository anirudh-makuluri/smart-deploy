import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import RepoPageClient from "./RepoPageClient";

type PageProps = {
	params: Promise<{ owner: string; repo: string }>;
};

export default async function RepoPage({ params }: PageProps) {
	const { owner, repo: repoName } = await params;

	let session: Awaited<ReturnType<typeof auth.api.getSession>> | null = null;
	try {
		session = await auth.api.getSession({ headers: await headers() });
	} catch (error) {
		console.error("Failed to read auth session for repo page:", error);
	}

	if (!session) {
		notFound();
	}

	return <RepoPageClient owner={owner} repoName={repoName} />;
}
