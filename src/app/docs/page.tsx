import type { Metadata } from "next";
import { DocsMarkdown } from "@/components/public/DocsMarkdown";
import { DocsSimpleLayout } from "@/components/public/DocsSimpleLayout";
import { PublicPageFooter } from "@/components/public/PublicPageFooter";
import { PublicPageScroll } from "@/components/public/PublicPageScroll";
import { listDocMarkdownFiles, readProjectReadme } from "@/lib/public-docs";

export const metadata: Metadata = {
	title: "Docs | Smart Deploy",
	description: "Renders the repository README and docs/ markdown from disk. No separate docs CMS.",
};

export default async function DocsPage() {
	const [readme, guideLinks] = await Promise.all([readProjectReadme(), listDocMarkdownFiles()]);

	return (
		<PublicPageScroll>
			<DocsSimpleLayout
				guideLinks={guideLinks}
				activeSlug={null}
				contentSourcePath="README.md (repository root)"
			>
				<DocsMarkdown source={readme} />
			</DocsSimpleLayout>
			<PublicPageFooter />
		</PublicPageScroll>
	);
}
