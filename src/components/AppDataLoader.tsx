"use client";

import { useAppData } from "@/store/useAppData";
import { useSession } from "next-auth/react";
import { useEffect, useState } from "react";
import { SmartDeployLogo } from "@/components/SmartDeployLogo";

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
			const t = setTimeout(() => setIsExiting(true), 700);
			return () => clearTimeout(t);
		}
	}, [isLoading]);

	if (isExiting) {
		return <div className="loading-fade-in">{children}</div>;
	}

	if (!isExiting) {
		return (
			<div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-10 landing-bg text-[#e2e8f0]">
				{/* Subtle grid */}
				<div
					className="pointer-events-none absolute inset-0 opacity-[0.03]"
					style={{
						backgroundImage: `
							linear-gradient(to right, #e2e8f0 1px, transparent 1px),
							linear-gradient(to bottom, #e2e8f0 1px, transparent 1px)
						`,
						backgroundSize: "24px 24px",
					}}
				/>
				<div className="relative flex flex-col items-center gap-10 px-6">
					<div className="flex flex-col items-center gap-6">
						<SmartDeployLogo showText size="lg" />
						<p className="text-sm text-[#94a3b8]">Loading your repos and services…</p>
					</div>
					{/* Progress bar */}
					<div className="w-full max-w-xs space-y-2">
						<div className="h-1.5 w-full overflow-hidden rounded-full bg-[#1e3a5f]">
							<div
								className="h-full rounded-full landing-build-blue transition-all duration-300 ease-out"
								style={{ width: `${progress}%` }}
							/>
						</div>
						<div className="flex justify-between text-xs text-[#94a3b8]">
							<span>{Math.round(progress)}%</span>
							<span className="animate-pulse">Preparing dashboard</span>
						</div>
					</div>
					{/* Loading dots */}
					<div className="flex gap-1.5" aria-hidden>
						<span
							className="h-2 w-2 rounded-full bg-[#1d4ed8] animate-bounce"
							style={{ animationDelay: "0ms" }}
						/>
						<span
							className="h-2 w-2 rounded-full bg-[#1d4ed8] animate-bounce"
							style={{ animationDelay: "150ms" }}
						/>
						<span
							className="h-2 w-2 rounded-full bg-[#1d4ed8] animate-bounce"
							style={{ animationDelay: "300ms" }}
						/>
					</div>
				</div>
			</div>
		);
	}

	return <>{children}</>;
}
