"use client"
import { useAppData } from "@/store/useAppData";
import { useSession } from "next-auth/react";
import { useEffect, useState } from "react";
import Image from "next/image";

export function AppDataLoader({ children }: React.PropsWithChildren) {
	const [progress, setProgress] = useState(0);
	const [isExiting, setIsExiting] = useState(false);
	const { status } = useSession();
	const { isLoading, fetchAll, unAuthenticated } = useAppData();

	useEffect(() => {
		if (status === "authenticated") fetchAll();
		if (status === "unauthenticated") unAuthenticated();

		const interval = setInterval(() => {
			setProgress((prev) => (prev >= 92 ? prev : prev + 4));
		}, 180);
		return () => clearInterval(interval);
	}, [status]);

	useEffect(() => {
		if (!isLoading) {
			setProgress(100);
			// Wait for bar to animate to 100% (300ms) + brief hold so user sees completion
			const t = setTimeout(() => setIsExiting(true), 700);
			return () => clearTimeout(t);
		}
	}, [isLoading]);

	// Show app with a short fade-in after loading completes
	if (isExiting) {
		return <div className="loading-fade-in">{children}</div>;
	}

	// Keep showing loader until we explicitly exit (so bar can reach 100% and hold)
	if (!isExiting) {
		return (
			<div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-10 bg-muted">
				{/* Subtle grid background */}
				<div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,oklch(1_0_0/0.03)_1px,transparent_1px),linear-gradient(to_bottom,oklch(1_0_0/0.03)_1px,transparent_1px)] bg-[size:24px_24px]" />
				<div className="relative flex flex-col items-center gap-10 px-6">
					{/* Logo + branding */}
					<div className="flex flex-col items-center gap-4">
						<div className="relative h-14 w-14 overflow-hidden rounded-xl bg-card shadow-lg ring-1 ring-border">
							<Image
								src="/logo.png"
								alt="Smart Deploy"
								fill
								className="object-contain p-1.5"
								priority
							/>
						</div>
						<div className="text-center">
							<h1 className="text-xl font-semibold tracking-tight text-foreground">
								Smart Deploy
							</h1>
							<p className="mt-1 text-sm text-muted-foreground">
								Loading your repos and services…
							</p>
						</div>
					</div>
					{/* Progress bar */}
					<div className="w-full max-w-xs space-y-2">
						<div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
							<div
								className="h-full rounded-full bg-primary transition-all duration-300 ease-out"
								style={{ width: `${progress}%` }}
							/>
						</div>
						<div className="flex justify-between text-xs text-muted-foreground">
							<span>{Math.round(progress)}%</span>
							<span className="animate-pulse">Preparing dashboard</span>
						</div>
					</div>
					{/* Loading dots */}
					<div className="flex gap-1.5" aria-hidden>
						<span className="h-2 w-2 rounded-full bg-primary animate-bounce [animation-delay:0ms]" />
						<span className="h-2 w-2 rounded-full bg-primary animate-bounce [animation-delay:150ms]" />
						<span className="h-2 w-2 rounded-full bg-primary animate-bounce [animation-delay:300ms]" />
					</div>
				</div>
			</div>
		);
	}

	return <>{children}</>;
}
