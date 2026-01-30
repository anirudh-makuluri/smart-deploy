"use client";

import Link from "next/link";
import { Rocket, Boxes, Cloud } from "lucide-react";
import { SmartDeployLogo } from "@/components/SmartDeployLogo";

export default function Landing() {
	return (
		<div className="landing-bg h-svh overflow-hidden flex flex-col text-[#e2e8f0]">
			{/* Top bar */}
			<header className="flex-shrink-0 flex items-center justify-between px-6 py-3 border-b border-[#1e3a5f]/60">
				<SmartDeployLogo />
				<Link
					href="/auth"
					className="landing-build-blue hover:opacity-95 text-white font-medium px-5 py-2.5 rounded-lg transition-all"
				>
					Sign in
				</Link>
			</header>

			{/* Main: asymmetric layout — left copy, right "multi-service" visual */}
			<main className="flex-1 min-h-0 flex flex-col lg:flex-row items-center justify-center gap-6 lg:gap-12 px-6 py-6 max-w-6xl mx-auto w-full">
				{/* Left: headline + CTA */}
				<div className="flex flex-col gap-3 lg:gap-4 text-center lg:text-left lg:max-w-xl">
					<p className="text-[#14b8a6] font-mono text-xs uppercase tracking-[0.2em]">
						Multi-service deployment platform
					</p>
					<h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold leading-tight tracking-tight">
						All your services.
						<br />
						<span className="text-[#94a3b8]">One platform.</span>
					</h1>
					<p className="text-[#94a3b8] text-sm lg:text-base">
						Connect repos. We pick the right target—Amplify, ECS, Cloud Run, and more. Deploy every service from one dashboard.
					</p>
					<div className="flex flex-col justify-center items-center sm:flex-row gap-2 justify-center lg:justify-start">
						<Link
							href="/auth"
							className="landing-build-blue hover:opacity-95 text-white font-semibold px-6 py-3.5 rounded-lg inline-flex items-center justify-center gap-2 transition-all"
						>
							<Rocket className="size-5" />
							Get started
						</Link>
						<span className="text-[#64748b] text-sm self-center lg:self-auto">
							AWS · GCP · One dashboard
						</span>
					</div>
				</div>

				{/* Right: "multi-service" visual — services flowing into one deploy */}
				<div className="relative w-full max-w-[280px] lg:max-w-sm aspect-square flex-shrink-0 flex items-center justify-center">
					{/* Connector lines (behind nodes) */}
					<svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
						<defs>
							<linearGradient id="lineGrad" x1="0%" y1="0%" x2="100%" y2="0%">
								<stop offset="0%" stopColor="#14b8a6" stopOpacity="0.5" />
								<stop offset="100%" stopColor="#1d4ed8" stopOpacity="0.6" />
							</linearGradient>
						</defs>
						{[
							[50, 18, 50, 42],
							[20, 32, 38, 42],
							[80, 32, 62, 42],
							[18, 68, 38, 58],
							[82, 68, 62, 58],
						].map(([x1, y1, x2, y2], i) => (
							<line
								key={i}
								x1={x1}
								y1={y1}
								x2={x2}
								y2={y2}
								stroke="url(#lineGrad)"
								strokeWidth="1.2"
								strokeDasharray="3 2"
								opacity="0.8"
							/>
						))}
					</svg>
					{/* Central "Deploy" node */}
					<div className="absolute inset-0 flex items-center justify-center">
						<div className="landing-build-blue w-24 h-24 rounded-2xl flex items-center justify-center shadow-lg shadow-blue-900/40 z-10">
							<Rocket className="size-10 text-white" />
						</div>
					</div>
					{/* Service nodes */}
					{[
						{ label: "API", top: "10%", left: "50%", color: "#14b8a6" },
						{ label: "Web", top: "26%", left: "14%", color: "#0d9488" },
						{ label: "Worker", top: "26%", left: "86%", color: "#0d9488" },
						{ label: "DB", top: "68%", left: "12%", color: "#f59e0b" },
						{ label: "Auth", top: "68%", left: "88%", color: "#f59e0b" },
					].map((s, i) => (
						<div
							key={i}
							className="absolute w-14 h-14 rounded-xl flex items-center justify-center border-2 text-xs font-medium z-10"
							style={{
								top: s.top,
								left: s.left,
								transform: "translate(-50%, -50%)",
								backgroundColor: "rgba(19, 47, 76, 0.95)",
								borderColor: s.color,
								color: s.color,
							}}
						>
							{s.label}
						</div>
					))}
				</div>
			</main>

			{/* Single value strip — not 3 cards, one clear line */}
			<section className="flex-shrink-0 landing-bg-muted border-t border-[#1e3a5f]/60 py-4 px-6">
				<div className="max-w-4xl mx-auto flex flex-col sm:flex-row items-center justify-center gap-4 sm:gap-8">
					<div className="flex items-center gap-2">
						<Boxes className="size-6 text-[#14b8a6]" />
						<span className="text-[#e2e8f0] text-sm font-medium">Multiple services, one repo or many</span>
					</div>
					<div className="hidden sm:block w-px h-6 bg-[#334155]" />
					<div className="flex items-center gap-2">
						<Cloud className="size-6 text-[#f59e0b]" />
						<span className="text-[#e2e8f0] text-sm font-medium">AWS + GCP — we choose the simplest target</span>
					</div>
				</div>
			</section>

			<footer className="flex-shrink-0 py-2 px-6 text-center text-[#64748b] text-xs border-t border-[#1e3a5f]/40">
				Smart Deploy — multi-service deployment, simplified.
			</footer>
		</div>
	);
}
