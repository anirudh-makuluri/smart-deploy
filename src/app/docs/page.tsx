import type { Metadata } from "next";
import { DocsMarkdown } from "@/components/public/DocsMarkdown";
import { DocsSimpleLayout } from "@/components/public/DocsSimpleLayout";
import { PublicPageFooter } from "@/components/public/PublicPageFooter";
import { PublicPageScroll } from "@/components/public/PublicPageScroll";
import { listDocMarkdownFiles, readProjectReadme } from "@/lib/public-docs";

export const metadata: Metadata = {
	title: "Docs | Smart Deploy",
	description: "Project README and documentation from the repository docs folder.",
};

export default async function DocsPage() {
	const [readme, guideLinks] = await Promise.all([readProjectReadme(), listDocMarkdownFiles()]);

	return (
		<PublicPageScroll>
			<DocsSimpleLayout guideLinks={guideLinks} activeSlug={null}>
				<DocsMarkdown source={readme} />
			</DocsSimpleLayout>
			<PublicPageFooter />
		</PublicPageScroll>
	);
}
