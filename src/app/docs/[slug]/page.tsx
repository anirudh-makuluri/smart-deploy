import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DocsMarkdown } from "@/components/public/DocsMarkdown";
import { DocsSimpleLayout } from "@/components/public/DocsSimpleLayout";
import { PublicPageFooter } from "@/components/public/PublicPageFooter";
import { PublicPageScroll } from "@/components/public/PublicPageScroll";
import { listDocMarkdownFiles, readDocsMarkdownBySlug } from "@/lib/public-docs";

type PageProps = { params: Promise<{ slug: string }> };

export async function generateStaticParams() {
	const files = await listDocMarkdownFiles();
	return files.map((f) => ({ slug: f.slug }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
	const { slug } = await params;
	const doc = await readDocsMarkdownBySlug(slug);
	if (!doc) {
		return { title: "Not found | Smart Deploy" };
	}
	return {
		title: `${doc.title} | Docs | Smart Deploy`,
		description: `Rendered from docs/${doc.filename} in the repository.`,
	};
}

export default async function DocsGuidePage({ params }: PageProps) {
	const { slug } = await params;
	const [doc, guideLinks] = await Promise.all([readDocsMarkdownBySlug(slug), listDocMarkdownFiles()]);

	if (!doc) {
		notFound();
	}

	return (
		<PublicPageScroll>
			<DocsSimpleLayout
				guideLinks={guideLinks}
				activeSlug={slug}
				contentSourcePath={`docs/${doc.filename}`}
			>
				<DocsMarkdown source={doc.content} />
			</DocsSimpleLayout>
			<PublicPageFooter />
		</PublicPageScroll>
	);
}
