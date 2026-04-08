import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import Providers from "@/components/Providers";
import { AccentSync } from "@/components/AccentSync";
import { Toaster } from "@/components/ui/sonner"


const geistSans = Geist({
	variable: "--font-geist-sans",
	subsets: ["latin"],
});

const geistMono = Geist_Mono({
	variable: "--font-geist-mono",
	subsets: ["latin"],
});

export const metadata: Metadata = {
	title: "Smart Deploy",
	description: "Deploy your code in an easy way",
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
				className={`${geistSans.variable} ${geistMono.variable} landing-bg text-foreground antialiased`}
				suppressHydrationWarning
			>
				<Providers>
					<AccentSync />
					{children}
					<Toaster />
				</Providers>

			</body>
		</html>
	);
}

