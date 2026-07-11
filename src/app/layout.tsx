import type { Metadata } from "next";
import Link from "next/link";
import { Bricolage_Grotesque, Hanken_Grotesk, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import Providers from "@/components/Providers";
import { AccentSync } from "@/components/AccentSync";
import { Toaster } from "@/components/ui/sonner"
import { Analytics } from '@vercel/analytics/next';

const fontDisplay = Bricolage_Grotesque({
	subsets: ["latin"],
	variable: "--font-display",
	display: "swap",
});

const fontBody = Hanken_Grotesk({
	subsets: ["latin"],
	variable: "--font-body",
	display: "swap",
});

const fontMono = IBM_Plex_Mono({
	subsets: ["latin"],
	weight: ["400", "500", "600"],
	variable: "--font-mono-face",
	display: "swap",
});

const organizationJsonLd = {
	"@context": "https://schema.org",
	"@type": "Organization",
	name: "Smart Deploy",
	url: "https://smart-deploy.xyz",
	logo: "https://smart-deploy.xyz/icon.svg",
};

function jsonLdString(value: unknown): string {
	return JSON.stringify(value).replace(/[<>&]/g, (char) => {
		if (char === "<") return "\\u003c";
		if (char === ">") return "\\u003e";
		return "\\u0026";
	});
}

export const metadata: Metadata = {
	metadataBase: new URL("https://smart-deploy.xyz"),
	title: {
		default: "Smart Deploy | Preview your deployment blueprint",
		template: "%s | Smart Deploy",
	},
	description:
		"Deploy without the black box. Generate build plans, preview routing and services as a blueprint, then ship with confidence.",
	openGraph: {
		type: "website",
		siteName: "Smart Deploy",
		title: "Smart Deploy | Preview your deployment blueprint",
		description:
			"Deploy without the black box. Generate build plans, preview routing and services as a blueprint, then ship with confidence.",
		url: "https://smart-deploy.xyz/",
	},
	twitter: {
		card: "summary_large_image",
		title: "Smart Deploy | Preview your deployment blueprint",
		description:
			"Deploy without the black box. Generate build plans, preview routing and services as a blueprint, then ship with confidence.",
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
				className={`landing-bg text-foreground antialiased ${fontDisplay.variable} ${fontBody.variable} ${fontMono.variable}`}
				suppressHydrationWarning
			>
				<script type="application/ld+json">{jsonLdString(organizationJsonLd)}</script>
				<Providers>
					<AccentSync />
					<blockquote className="sr-only">
						For the complete documentation index, see <Link href="/llms.txt">llms.txt</Link>.
					</blockquote>
					{children}
					<Toaster />
				</Providers>
				<Analytics />

			</body>
		</html>
	);
}
