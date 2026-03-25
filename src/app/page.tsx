"use client";

import { useEffect } from "react";
import { useSession } from "next-auth/react";
import { LandingExperience } from "@/components/landing/LandingExperience";

export default function Home() {
	const { data: session } = useSession();

	useEffect(() => {
		if (typeof window === "undefined") return;
		document.documentElement.setAttribute("data-accent", "blue");
	}, []);

	return <LandingExperience isSignedIn={Boolean(session)} />;
}
