import type { Metadata } from "next";
import "./globals.css";
import Providers from "@/components/Providers";
import { AccentSync } from "@/components/AccentSync";
import { Toaster } from "@/components/ui/sonner"

const organizationJsonLd = {
	"@context": "https://schema.org",
	"@type": "Organization",
	name: "Smart Deploy",
	url: "https://smart-deploy.xyz",
	logo: "https://smart-deploy.xyz/icon.svg",
};

export const metadata: Metadata = {
	metadataBase: new URL("https://smart-deploy.xyz"),
	title: {
		default: "Smart Deploy | Preview your deployment blueprint (Docker, Compose, Nginx)",
		template: "%s | Smart Deploy",
	},
	description:
		"Deploy without the black box. Generate or bring Docker, Compose, and Nginx, preview routing and services as a blueprint, then ship with confidence.",
	openGraph: {
		type: "website",
		siteName: "Smart Deploy",
		title: "Smart Deploy | Preview your deployment blueprint (Docker, Compose, Nginx)",
		description:
			"Deploy without the black box. Generate or bring Docker, Compose, and Nginx, preview routing and services as a blueprint, then ship with confidence.",
		url: "https://smart-deploy.xyz/",
	},
	twitter: {
		card: "summary_large_image",
		title: "Smart Deploy | Preview your deployment blueprint (Docker, Compose, Nginx)",
		description:
			"Deploy without the black box. Generate or bring Docker, Compose, and Nginx, preview routing and services as a blueprint, then ship with confidence.",
	},
	icons: {
		icon: "/icon.svg",
	},
};

export default function RootLayout({
	children
}: Readonly<{
	children: React.ReactNode;
}>) {
	return (
		<html lang="en" className="dark" data-accent="blue">
			<body
				className="landing-bg text-foreground antialiased"
				suppressHydrationWarning
			>
				<script
					type="application/ld+json"
					dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationJsonLd) }}
				/>
				<Providers>
					<AccentSync />
					<blockquote className="sr-only">
						For the complete documentation index, see <a href="/llms.txt">llms.txt</a>.
					</blockquote>
					{children}
					<Toaster />
				</Providers>

			</body>
		</html>
	);
}

