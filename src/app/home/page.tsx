import type { Metadata } from "next";
import { Suspense } from "react";
import HomePageClient from "./HomePageClient";

export const metadata: Metadata = {
	title: "Dashboard",
	robots: {
		index: false,
		follow: false,
	},
};

export default function HomePage() {
	return (
		<Suspense fallback={null}>
			<HomePageClient />
		</Suspense>
	);
}
