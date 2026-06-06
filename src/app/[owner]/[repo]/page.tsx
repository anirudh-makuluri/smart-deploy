import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import RepoPageClient from "./RepoPageClient";

type PageProps = {
	params: Promise<{ owner: string; repo: string }>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
	const { owner, repo } = await params;
	return {
		title: `${owner}/${repo}`,
		robots: {
			index: false,
			follow: false,
		},
	};
}

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
