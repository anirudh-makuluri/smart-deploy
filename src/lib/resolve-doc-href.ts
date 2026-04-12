import { slugFromMarkdownFilename } from "@/lib/public-docs";

/** Map repository-relative README links to site URLs when viewing docs on `/docs`. */
export function resolveDocHref(href: string): string {
	if (!href || href.startsWith("http") || href.startsWith("/") || href.startsWith("#") || href.startsWith("mailto:")) {
		return href;
	}

	const docFile = /^docs\/(.+\.md)$/i.exec(href);
	if (docFile) {
		return `/docs/${slugFromMarkdownFilename(docFile[1])}`;
	}

	if (href.startsWith("public/")) {
		return `/${href.slice("public/".length)}`;
	}

	return href;
}
