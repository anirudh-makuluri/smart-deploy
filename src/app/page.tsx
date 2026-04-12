"use client";

import { useSession } from "next-auth/react";
import { LandingExperience } from "@/components/landing/LandingExperience";

export default function Home() {
	const { data: session } = useSession();

	return <LandingExperience isSignedIn={Boolean(session)} />;
}
