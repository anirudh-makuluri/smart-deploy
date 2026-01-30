"use client";

import Link from "next/link";
import { Rocket, Boxes, Cloud, GitBranch, Zap, Database, Globe, CheckCircle2 } from "lucide-react";
import { SmartDeployLogo } from "@/components/SmartDeployLogo";

export default function Landing() {
	return (
		<div className="landing-bg min-h-svh flex flex-col text-[#e2e8f0]">
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

			{/* How It Works Section */}
			<section className="flex-1 py-16 px-6 border-t border-[#1e3a5f]/60">
				<div className="max-w-6xl mx-auto">
					<div className="text-center mb-12">
						<h2 className="text-3xl sm:text-4xl font-bold mb-3">How It Works</h2>
						<p className="text-[#94a3b8] text-lg max-w-2xl mx-auto">
							SmartDeploy automatically analyzes your codebase and selects the optimal deployment target. Here's how we choose:
						</p>
					</div>

					{/* Service Selection Flowchart */}
					<div className="mb-16">
						<h3 className="text-xl font-semibold mb-6 text-center text-[#14b8a6]">Service Selection Flow</h3>
						<div className="bg-[#0f172a]/50 rounded-xl p-6 sm:p-8 border border-[#1e3a5f]/60 overflow-x-auto">
							<div className="min-w-[600px] mx-auto">
								<svg viewBox="0 0 800 900" className="w-full h-auto">
									<defs>
										<marker id="arrowhead" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto">
											<polygon points="0 0, 10 3, 0 6" fill="#14b8a6" />
										</marker>
										<linearGradient id="startGrad" x1="0%" y1="0%" x2="0%" y2="100%">
											<stop offset="0%" stopColor="#14b8a6" stopOpacity="0.3" />
											<stop offset="100%" stopColor="#1d4ed8" stopOpacity="0.3" />
										</linearGradient>
									</defs>

									{/* Start Node */}
									<rect x="300" y="20" width="200" height="50" rx="8" fill="url(#startGrad)" stroke="#14b8a6" strokeWidth="2" />
									<text x="400" y="50" textAnchor="middle" fill="#e2e8f0" fontSize="14" fontWeight="600">Connect Repository</text>

									{/* AI Analysis Node */}
									<rect x="300" y="100" width="200" height="50" rx="8" fill="#1e3a5f" stroke="#14b8a6" strokeWidth="2" />
									<text x="400" y="130" textAnchor="middle" fill="#e2e8f0" fontSize="13">AI Analysis</text>

									{/* Decision: LLM Compatibility */}
									<polygon points="350,180 450,180 400,220" fill="#1e3a5f" stroke="#14b8a6" strokeWidth="2" />
									<text x="400" y="200" textAnchor="middle" fill="#e2e8f0" fontSize="11">LLM Compatibility?</text>

									{/* Yes path - Simplest Compatible */}
									<rect x="50" y="250" width="180" height="60" rx="8" fill="#0f766e" stroke="#14b8a6" strokeWidth="2" />
									<text x="140" y="275" textAnchor="middle" fill="#e2e8f0" fontSize="12" fontWeight="600">Pick Simplest</text>
									<text x="140" y="295" textAnchor="middle" fill="#e2e8f0" fontSize="11">Compatible Target</text>

									{/* No path - Rule-based checks */}
									<rect x="570" y="250" width="180" height="60" rx="8" fill="#1e3a5f" stroke="#f59e0b" strokeWidth="2" />
									<text x="660" y="275" textAnchor="middle" fill="#e2e8f0" fontSize="12" fontWeight="600">Rule-Based</text>
									<text x="660" y="295" textAnchor="middle" fill="#e2e8f0" fontSize="11">Selection</text>

									{/* Multi-service check */}
									<polygon points="620,350 700,350 660,390" fill="#1e3a5f" stroke="#f59e0b" strokeWidth="2" />
									<text x="660" y="375" textAnchor="middle" fill="#e2e8f0" fontSize="11">Multi-service?</text>

									{/* Database check */}
									<polygon points="620,430 700,430 660,470" fill="#1e3a5f" stroke="#f59e0b" strokeWidth="2" />
									<text x="660" y="455" textAnchor="middle" fill="#e2e8f0" fontSize="11">Database?</text>

									{/* WebSocket check */}
									<polygon points="620,510 700,510 660,550" fill="#1e3a5f" stroke="#f59e0b" strokeWidth="2" />
									<text x="660" y="535" textAnchor="middle" fill="#e2e8f0" fontSize="11">WebSockets?</text>

									{/* Node static check */}
									<polygon points="620,590 700,590 660,630" fill="#1e3a5f" stroke="#f59e0b" strokeWidth="2" />
									<text x="660" y="615" textAnchor="middle" fill="#e2e8f0" fontSize="11">Node Static?</text>

									{/* EB language check */}
									<polygon points="620,670 700,670 660,710" fill="#1e3a5f" stroke="#f59e0b" strokeWidth="2" />
									<text x="660" y="695" textAnchor="middle" fill="#e2e8f0" fontSize="11">EB Language?</text>

									{/* Dockerfile check */}
									<polygon points="620,750 700,750 660,790" fill="#1e3a5f" stroke="#f59e0b" strokeWidth="2" />
									<text x="660" y="775" textAnchor="middle" fill="#e2e8f0" fontSize="11">Dockerfile?</text>

									{/* Target Results */}
									{/* ECS */}
									<rect x="50" y="360" width="140" height="50" rx="8" fill="#1e40af" stroke="#60a5fa" strokeWidth="2" />
									<text x="120" y="385" textAnchor="middle" fill="#e2e8f0" fontSize="12" fontWeight="600">ECS Fargate</text>
									<text x="120" y="400" textAnchor="middle" fill="#94a3b8" fontSize="10">Multi-service/DB</text>

									{/* Amplify */}
									<rect x="50" y="600" width="140" height="50" rx="8" fill="#059669" stroke="#34d399" strokeWidth="2" />
									<text x="120" y="625" textAnchor="middle" fill="#e2e8f0" fontSize="12" fontWeight="600">AWS Amplify</text>
									<text x="120" y="640" textAnchor="middle" fill="#94a3b8" fontSize="10">Static/Frontend</text>

									{/* Elastic Beanstalk */}
									<rect x="50" y="680" width="140" height="50" rx="8" fill="#7c3aed" stroke="#a78bfa" strokeWidth="2" />
									<text x="120" y="700" textAnchor="middle" fill="#e2e8f0" fontSize="11" fontWeight="600">Elastic Beanstalk</text>
									<text x="120" y="715" textAnchor="middle" fill="#94a3b8" fontSize="10">Simple Apps</text>

									{/* Cloud Run */}
									<rect x="50" y="450" width="140" height="50" rx="8" fill="#ea580c" stroke="#fb923c" strokeWidth="2" />
									<text x="120" y="475" textAnchor="middle" fill="#e2e8f0" fontSize="12" fontWeight="600">Cloud Run</text>
									<text x="120" y="490" textAnchor="middle" fill="#94a3b8" fontSize="10">Containerized</text>

									{/* EC2 */}
									<rect x="50" y="760" width="140" height="50" rx="8" fill="#991b1b" stroke="#f87171" strokeWidth="2" />
									<text x="120" y="785" textAnchor="middle" fill="#e2e8f0" fontSize="12" fontWeight="600">EC2</text>
									<text x="120" y="800" textAnchor="middle" fill="#94a3b8" fontSize="10">Full Control</text>

									{/* Arrows */}
									<line x1="400" y1="70" x2="400" y2="100" stroke="#14b8a6" strokeWidth="2" markerEnd="url(#arrowhead)" />
									<line x1="400" y1="150" x2="400" y2="180" stroke="#14b8a6" strokeWidth="2" markerEnd="url(#arrowhead)" />
									<line x1="350" y1="200" x2="140" y2="250" stroke="#14b8a6" strokeWidth="2" markerEnd="url(#arrowhead)" />
									<line x1="450" y1="200" x2="660" y2="250" stroke="#f59e0b" strokeWidth="2" markerEnd="url(#arrowhead)" />
									<line x1="140" y1="310" x2="120" y2="360" stroke="#14b8a6" strokeWidth="2" markerEnd="url(#arrowhead)" />
									<line x1="660" y1="310" x2="660" y2="350" stroke="#f59e0b" strokeWidth="2" markerEnd="url(#arrowhead)" />
									<line x1="620" y1="370" x2="120" y2="385" stroke="#f59e0b" strokeWidth="2" markerEnd="url(#arrowhead)" />
									<line x1="660" y1="390" x2="660" y2="430" stroke="#f59e0b" strokeWidth="2" markerEnd="url(#arrowhead)" />
									<line x1="620" y1="450" x2="120" y2="475" stroke="#f59e0b" strokeWidth="2" markerEnd="url(#arrowhead)" />
									<line x1="660" y1="470" x2="660" y2="510" stroke="#f59e0b" strokeWidth="2" markerEnd="url(#arrowhead)" />
									<line x1="620" y1="530" x2="120" y2="385" stroke="#f59e0b" strokeWidth="2" markerEnd="url(#arrowhead)" />
									<line x1="660" y1="550" x2="660" y2="590" stroke="#f59e0b" strokeWidth="2" markerEnd="url(#arrowhead)" />
									<line x1="620" y1="610" x2="120" y2="625" stroke="#f59e0b" strokeWidth="2" markerEnd="url(#arrowhead)" />
									<line x1="660" y1="630" x2="660" y2="670" stroke="#f59e0b" strokeWidth="2" markerEnd="url(#arrowhead)" />
									<line x1="620" y1="690" x2="120" y2="705" stroke="#f59e0b" strokeWidth="2" markerEnd="url(#arrowhead)" />
									<line x1="660" y1="710" x2="660" y2="750" stroke="#f59e0b" strokeWidth="2" markerEnd="url(#arrowhead)" />
									<line x1="620" y1="770" x2="120" y2="385" stroke="#f59e0b" strokeWidth="2" markerEnd="url(#arrowhead)" />
									<line x1="660" y1="790" x2="120" y2="785" stroke="#f59e0b" strokeWidth="2" markerEnd="url(#arrowhead)" />

									{/* Labels */}
									<text x="200" y="245" fill="#14b8a6" fontSize="10" fontWeight="600">Yes</text>
									<text x="520" y="245" fill="#f59e0b" fontSize="10" fontWeight="600">No</text>
									<text x="580" y="365" fill="#f59e0b" fontSize="10" fontWeight="600">Yes</text>
									<text x="580" y="445" fill="#f59e0b" fontSize="10" fontWeight="600">Yes</text>
									<text x="580" y="525" fill="#f59e0b" fontSize="10" fontWeight="600">Yes</text>
									<text x="580" y="605" fill="#f59e0b" fontSize="10" fontWeight="600">Yes</text>
									<text x="580" y="685" fill="#f59e0b" fontSize="10" fontWeight="600">Yes</text>
									<text x="580" y="765" fill="#f59e0b" fontSize="10" fontWeight="600">Yes</text>
									<text x="580" y="845" fill="#f59e0b" fontSize="10" fontWeight="600">No</text>
								</svg>
							</div>
						</div>
					</div>

					{/* Key Features Grid */}
					<div className="mb-16">
						<h3 className="text-xl font-semibold mb-6 text-center text-[#14b8a6]">Key Features</h3>
						<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
							<div className="bg-[#0f172a]/50 rounded-lg p-6 border border-[#1e3a5f]/60">
								<div className="flex items-center gap-3 mb-3">
									<Zap className="size-6 text-[#14b8a6]" />
									<h4 className="text-lg font-semibold">AI-Powered Analysis</h4>
								</div>
								<p className="text-[#94a3b8] text-sm">
									Automatically detects language, framework, database requirements, and generates optimal deployment configuration.
								</p>
							</div>

							<div className="bg-[#0f172a]/50 rounded-lg p-6 border border-[#1e3a5f]/60">
								<div className="flex items-center gap-3 mb-3">
									<Boxes className="size-6 text-[#14b8a6]" />
									<h4 className="text-lg font-semibold">Multi-Service Support</h4>
								</div>
								<p className="text-[#94a3b8] text-sm">
									Detects and deploys complex applications with multiple services from docker-compose or algorithmic detection.
								</p>
							</div>

							<div className="bg-[#0f172a]/50 rounded-lg p-6 border border-[#1e3a5f]/60">
								<div className="flex items-center gap-3 mb-3">
									<Database className="size-6 text-[#14b8a6]" />
									<h4 className="text-lg font-semibold">Database Provisioning</h4>
								</div>
								<p className="text-[#94a3b8] text-sm">
									Automatically detects database requirements and provisions Cloud SQL instances (PostgreSQL, MySQL, MSSQL).
								</p>
							</div>

							<div className="bg-[#0f172a]/50 rounded-lg p-6 border border-[#1e3a5f]/60">
								<div className="flex items-center gap-3 mb-3">
									<Cloud className="size-6 text-[#14b8a6]" />
									<h4 className="text-lg font-semibold">Multi-Cloud Support</h4>
								</div>
								<p className="text-[#94a3b8] text-sm">
									Deploy to AWS (Amplify, ECS, Elastic Beanstalk, EC2) or GCP (Cloud Run) - we choose the best fit.
								</p>
							</div>

							<div className="bg-[#0f172a]/50 rounded-lg p-6 border border-[#1e3a5f]/60">
								<div className="flex items-center gap-3 mb-3">
									<GitBranch className="size-6 text-[#14b8a6]" />
									<h4 className="text-lg font-semibold">GitHub Integration</h4>
								</div>
								<p className="text-[#94a3b8] text-sm">
									Connect any GitHub repository with OAuth. Deploy from public or private repos seamlessly.
								</p>
							</div>

							<div className="bg-[#0f172a]/50 rounded-lg p-6 border border-[#1e3a5f]/60">
								<div className="flex items-center gap-3 mb-3">
									<Globe className="size-6 text-[#14b8a6]" />
									<h4 className="text-lg font-semibold">Live Deployment Logs</h4>
								</div>
								<p className="text-[#94a3b8] text-sm">
									Real-time WebSocket updates during deployment. Monitor build progress and troubleshoot issues instantly.
								</p>
							</div>
						</div>
					</div>

					{/* Supported Platforms */}
					<div className="mb-16">
						<h3 className="text-xl font-semibold mb-6 text-center text-[#14b8a6]">Supported Platforms & Languages</h3>
						<div className="grid grid-cols-1 md:grid-cols-2 gap-8">
							<div className="bg-[#0f172a]/50 rounded-lg p-6 border border-[#1e3a5f]/60">
								<h4 className="text-lg font-semibold mb-4 flex items-center gap-2">
									<Cloud className="size-5 text-[#f59e0b]" />
									Deployment Targets
								</h4>
								<ul className="space-y-2 text-[#94a3b8] text-sm">
									<li className="flex items-center gap-2">
										<CheckCircle2 className="size-4 text-[#14b8a6]" />
										<span><strong className="text-[#e2e8f0]">AWS Amplify</strong> - Static sites & frontend apps</span>
									</li>
									<li className="flex items-center gap-2">
										<CheckCircle2 className="size-4 text-[#14b8a6]" />
										<span><strong className="text-[#e2e8f0]">Elastic Beanstalk</strong> - Simple serverless apps</span>
									</li>
									<li className="flex items-center gap-2">
										<CheckCircle2 className="size-4 text-[#14b8a6]" />
										<span><strong className="text-[#e2e8f0]">ECS Fargate</strong> - Containerized & multi-service</span>
									</li>
									<li className="flex items-center gap-2">
										<CheckCircle2 className="size-4 text-[#14b8a6]" />
										<span><strong className="text-[#e2e8f0]">Cloud Run</strong> - Serverless containers (GCP)</span>
									</li>
									<li className="flex items-center gap-2">
										<CheckCircle2 className="size-4 text-[#14b8a6]" />
										<span><strong className="text-[#e2e8f0]">EC2</strong> - Full control & complex apps</span>
									</li>
								</ul>
							</div>

							<div className="bg-[#0f172a]/50 rounded-lg p-6 border border-[#1e3a5f]/60">
								<h4 className="text-lg font-semibold mb-4 flex items-center gap-2">
									<Zap className="size-5 text-[#14b8a6]" />
									Languages & Frameworks
								</h4>
								<ul className="space-y-2 text-[#94a3b8] text-sm">
									<li className="flex items-center gap-2">
										<CheckCircle2 className="size-4 text-[#14b8a6]" />
										<span><strong className="text-[#e2e8f0]">Node.js</strong> - Next.js, Express, React, Vue</span>
									</li>
									<li className="flex items-center gap-2">
										<CheckCircle2 className="size-4 text-[#14b8a6]" />
										<span><strong className="text-[#e2e8f0]">Python</strong> - Django, FastAPI, Flask</span>
									</li>
									<li className="flex items-center gap-2">
										<CheckCircle2 className="size-4 text-[#14b8a6]" />
										<span><strong className="text-[#e2e8f0]">Go</strong> - Native Go applications</span>
									</li>
									<li className="flex items-center gap-2">
										<CheckCircle2 className="size-4 text-[#14b8a6]" />
										<span><strong className="text-[#e2e8f0]">Java</strong> - Spring Boot, Maven, Gradle</span>
									</li>
									<li className="flex items-center gap-2">
										<CheckCircle2 className="size-4 text-[#14b8a6]" />
										<span><strong className="text-[#e2e8f0]">.NET</strong> - C# ASP.NET applications</span>
									</li>
									<li className="flex items-center gap-2">
										<CheckCircle2 className="size-4 text-[#14b8a6]" />
										<span><strong className="text-[#e2e8f0]">Rust</strong> - Containerized deployments</span>
									</li>
									<li className="flex items-center gap-2">
										<CheckCircle2 className="size-4 text-[#14b8a6]" />
										<span><strong className="text-[#e2e8f0]">PHP & Ruby</strong> - Full framework support</span>
									</li>
								</ul>
							</div>
						</div>
					</div>

					{/* How It Works Steps */}
					<div>
						<h3 className="text-xl font-semibold mb-6 text-center text-[#14b8a6]">Simple 3-Step Process</h3>
						<div className="grid grid-cols-1 md:grid-cols-3 gap-6">
							<div className="bg-[#0f172a]/50 rounded-lg p-6 border border-[#1e3a5f]/60 text-center">
								<div className="w-12 h-12 rounded-full bg-[#14b8a6]/20 flex items-center justify-center mx-auto mb-4">
									<span className="text-2xl font-bold text-[#14b8a6]">1</span>
								</div>
								<h4 className="text-lg font-semibold mb-2">Connect Repository</h4>
								<p className="text-[#94a3b8] text-sm">
									Sign in with GitHub and select any repository. Public or private, we've got you covered.
								</p>
							</div>

							<div className="bg-[#0f172a]/50 rounded-lg p-6 border border-[#1e3a5f]/60 text-center">
								<div className="w-12 h-12 rounded-full bg-[#14b8a6]/20 flex items-center justify-center mx-auto mb-4">
									<span className="text-2xl font-bold text-[#14b8a6]">2</span>
								</div>
								<h4 className="text-lg font-semibold mb-2">AI Analysis & Config</h4>
								<p className="text-[#94a3b8] text-sm">
									Our AI scans your codebase, detects services, and auto-configures deployment settings. Review and customize as needed.
								</p>
							</div>

							<div className="bg-[#0f172a]/50 rounded-lg p-6 border border-[#1e3a5f]/60 text-center">
								<div className="w-12 h-12 rounded-full bg-[#14b8a6]/20 flex items-center justify-center mx-auto mb-4">
									<span className="text-2xl font-bold text-[#14b8a6]">3</span>
								</div>
								<h4 className="text-lg font-semibold mb-2">Deploy & Monitor</h4>
								<p className="text-[#94a3b8] text-sm">
									One-click deployment with live logs. Get URLs for all services and manage them from one dashboard.
								</p>
							</div>
						</div>
					</div>
				</div>
			</section>

			<footer className="flex-shrink-0 py-2 px-6 text-center text-[#64748b] text-xs border-t border-[#1e3a5f]/40">
				Smart Deploy — multi-service deployment, simplified.
			</footer>
		</div>
	);
}
