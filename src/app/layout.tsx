import type { Metadata } from "next";
import "./globals.css";
import Providers from "@/components/Providers";
import { AccentSync } from "@/components/AccentSync";
import { Toaster } from "@/components/ui/sonner"

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
				className="landing-bg text-foreground antialiased"
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

