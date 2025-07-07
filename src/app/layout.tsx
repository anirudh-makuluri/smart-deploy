import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import SessionWrapper from "@/components/SessionWrapper";
import { AppDataLoader } from "@/components/AppDataLoader";
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
};

export default function RootLayout({
	children
}: Readonly<{
	children: React.ReactNode;
}>) {
	return (
		<html lang="en" className="dark">
			<body
				className={`${geistSans.variable} ${geistMono.variable} bg-muted antialiased`}
			>
				<SessionWrapper>
					<AppDataLoader>
						{children}
						<Toaster />
					</AppDataLoader>
				</SessionWrapper>

			</body>
		</html>
	);
}
