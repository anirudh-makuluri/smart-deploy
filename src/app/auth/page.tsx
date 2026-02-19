"use client";

import { SmartDeployLogo } from "@/components/SmartDeployLogo";
import { LoginForm } from "@/components/login-form";
import { useSearchParams, useRouter } from "next/navigation";
import { useEffect, Suspense } from "react";

function AuthPageContent() {
	const searchParams = useSearchParams();
	const router = useRouter();

	useEffect(() => {
		// Check if there's an access denied error and redirect to waiting list
		const error = searchParams.get('error');
		if (error === 'AccessDenied' || error === 'CredentialsSignin') {
			router.replace('/waiting-list');
		}
	}, [searchParams, router]);

	return (
		<div className="landing-bg min-h-svh flex flex-col items-center justify-center p-6 text-foreground">
			<div className="flex w-full max-w-sm flex-col gap-6">
				<SmartDeployLogo showText size="md" className="self-center" />
				<LoginForm />
			</div>
		</div>
	);
}

export default function AuthPage() {
	return (
		<Suspense fallback={
			<div className="landing-bg min-h-svh flex flex-col items-center justify-center p-6 text-foreground">
				<div className="flex w-full max-w-sm flex-col gap-6">
					<SmartDeployLogo showText size="md" className="self-center" />
					<LoginForm />
				</div>
			</div>
		}>
			<AuthPageContent />
		</Suspense>
	);
}

