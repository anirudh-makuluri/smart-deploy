import type { MetadataRoute } from "next";
import { listDocMarkdownFiles } from "@/lib/public-docs";

const siteUrl = "https://smart-deploy.xyz";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
	const docs = await listDocMarkdownFiles();
	const now = new Date();

	const staticPages: MetadataRoute.Sitemap = [
		{
			url: `${siteUrl}/`,
			lastModified: now,
			changeFrequency: "daily",
			priority: 1,
		},
		{
			url: `${siteUrl}/docs`,
			lastModified: now,
			changeFrequency: "weekly",
			priority: 0.8,
		},
		{
			url: `${siteUrl}/changelog`,
			lastModified: now,
			changeFrequency: "weekly",
			priority: 0.7,
		},
	];

	const docPages: MetadataRoute.Sitemap = docs.map((doc) => ({
		url: `${siteUrl}/docs/${doc.slug}`,
		lastModified: now,
		changeFrequency: "weekly",
		priority: 0.6,
	}));

	return [...staticPages, ...docPages];
}
