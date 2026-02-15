"use client";

import { useSession } from "next-auth/react";
import { Boxes, Cloud, GitBranch, Zap, Database, Globe, CheckCircle2 } from "lucide-react";
import { SmartDeployLogo } from "@/components/SmartDeployLogo";
import Link from "next/link";
import { Scan, Package, Rocket, FileText, Github, Twitter, Linkedin, CheckCircle } from "lucide-react";
import { useState, useEffect } from "react";

export default function Home() {
	const { data: session } = useSession();

	const terminalLines = [
		"[INFO] Scanning entry points... found /pages, /api",
		"[INFO] Target: Next.js SSR build (Node 18+)",
		"[INFO] Installing NPM packages → 187 packages",
		'{ service: "elastic-beanstalk", region: "us-west-2" }',
		"Deploying services online",
		"→ https://my-app.smartdeploy.io",
	];

	const [displayedText, setDisplayedText] = useState<string[]>([]);
	const [currentLineIndex, setCurrentLineIndex] = useState(0);
	const [currentCharIndex, setCurrentCharIndex] = useState(0);
	const [cursorVisible, setCursorVisible] = useState(true);
	const [blinkCount, setBlinkCount] = useState(0);
	const [accentColor, setAccentColor] = useState<"green" | "blue" | "red">("green");

	useEffect(() => {
		const stored = typeof window !== "undefined"
			? localStorage.getItem("smartdeploy-accent")
			: null;
		if (stored === "green" || stored === "blue" || stored === "red") {
			setAccentColor(stored);
			document.documentElement.setAttribute("data-accent", stored);
			return;
		}
		document.documentElement.setAttribute("data-accent", "green");
	}, []);

	function handleAccentChange(color: "green" | "blue" | "red") {
		setAccentColor(color);
		if (typeof window !== "undefined") {
			localStorage.setItem("smartdeploy-accent", color);
		}
		document.documentElement.setAttribute("data-accent", color);
	}

	useEffect(() => {
		if (currentLineIndex >= terminalLines.length) {

			const restartTimer = setTimeout(() => {
				setDisplayedText([]);
				setCurrentLineIndex(0);
				setCurrentCharIndex(0);
				setBlinkCount(0);
				setCursorVisible(true);
			}, 2000);

			return () => clearTimeout(restartTimer);
		}

		const currentLine = terminalLines[currentLineIndex];
		
		if (currentCharIndex < currentLine.length) {
			const timer = setTimeout(() => {
				setDisplayedText(prev => {
					const newText = [...prev];
					if (!newText[currentLineIndex]) {
						newText[currentLineIndex] = "";
					}
					newText[currentLineIndex] = currentLine.slice(0, currentCharIndex + 1);
					return newText;
				});
				setCurrentCharIndex(currentCharIndex + 1);
			}, 30); // Speed of typing (30ms per character)

			return () => clearTimeout(timer);
		} else if (blinkCount < 4) {
			// Blink cursor at least 2 times (4 state changes: visible->hidden->visible->hidden)
			const timer = setTimeout(() => {
				setCursorVisible(!cursorVisible);
				setBlinkCount(blinkCount + 1);
			}, 500); // Blink every 500ms

			return () => clearTimeout(timer);
		} else {
			// After blinking, move to next line
			const timer = setTimeout(() => {
				setCurrentLineIndex(currentLineIndex + 1);
				setCurrentCharIndex(0);
				setBlinkCount(0);
				setCursorVisible(true);
			}, 500);

			return () => clearTimeout(timer);
		}
	}, [currentCharIndex, currentLineIndex, terminalLines, blinkCount, cursorVisible]);

	const getLineColor = (index: number, text: string) => {
		if (text.startsWith("[INFO]") || text.includes("Deploying") || text.includes("✓")) {
			return "text-primary";
		}
		return "text-muted-foreground";
	};

	return (
		<div className="landing-bg min-h-svh flex flex-col text-foreground">
			{/* Header */}
			<header className="sticky top-0 z-50 shrink-0 flex items-center justify-between px-6 lg:px-12 py-4 border-b border-border/50 bg-background/95 backdrop-blur supports-backdrop-filter:bg-background/60">
				<SmartDeployLogo href="/" />
				<nav className="hidden md:flex items-center gap-8 text-sm">
					<Link href="#features" className="text-muted-foreground hover:text-foreground transition-colors">
						Features
					</Link>
					<Link href="#how-it-works" className="text-muted-foreground hover:text-foreground transition-colors">
						How It Works
					</Link>
					<Link href="#docs" className="text-muted-foreground hover:text-foreground transition-colors">
						Docs
					</Link>
					<Link href="#pricing" className="text-muted-foreground hover:text-foreground transition-colors">
						Pricing
					</Link>
				</nav>
				<div className="flex items-center gap-3">
					<Link
						href={session ? "/home" : "/auth"}
						className="bg-primary hover:bg-primary/90 text-primary-foreground font-medium px-5 py-2 rounded-md transition-all text-sm"
					>
						{session ? "Go to Dashboard" : "Get Started"}
					</Link>
				</div>
			</header>

			{/* Hero Section */}
			<section className="flex-1 px-6 lg:px-12 py-16 lg:py-24">
				<div className="max-w-7xl mx-auto grid lg:grid-cols-2 gap-12 items-center">
					{/* Left Side */}
					<div className="flex flex-col gap-6">
						<p className="text-primary font-mono text-xs uppercase tracking-wider">
							TRYING REACT // AP.JS
						</p>
						<h1 className="text-5xl lg:text-7xl font-bold leading-tight">
							Code to <span className="text-primary">Cloud.</span>
						</h1>
						<div className="flex flex-col gap-2 text-muted-foreground">
							<p className="flex items-start gap-2">
								<span className="text-primary">&gt;</span>
								<span>AI-driven infrastructure orchestration.</span>
							</p>
							<p className="flex items-start gap-2">
								<span className="text-primary">&gt;</span>
								<span>Zero-config deployments.</span>
							</p>
							<p className="flex items-start gap-2">
								<span className="text-primary">&gt;</span>
								<span>Global edge distribution.</span>
							</p>
						</div>
						<div className="flex justify-center sm:justify-start flex-wrap gap-3 mt-4">
							<Link
								href={session ? "/home" : "/auth"}
								className="bg-primary hover:bg-primary/90 text-primary-foreground font-mono font-medium px-6 py-3 rounded-md transition-all text-sm"
							>
								TEST_DEPLOYMENTS --force
							</Link>
							<Link
								href="#docs"
								className="bg-muted hover:bg-muted/80 text-foreground font-mono font-medium px-6 py-3 rounded-md transition-all text-sm inline-flex items-center gap-2"
							>
								VIEW_DOCS 📄
							</Link>
						</div>
					</div>

					{/* Right Side - Terminal */}
					<div className="relative">
						<div className="bg-black/90 border border-primary/30 rounded-lg p-6 font-mono text-sm shadow-2xl shadow-primary/20">
							<div className="flex items-center gap-2 mb-4 pb-3 border-b border-primary/30">
								<div className="flex items-center gap-2 ml-2">
									<button
										type="button"
										onClick={() => handleAccentChange("green")}
										className={`size-4 rounded-full border transition-all ${
											accentColor === "green"
												? "border-primary/70 ring-2 ring-primary/40"
												: "border-border/70 hover:border-primary/40"
										}`}
										aria-label="Set accent color to green"
										aria-pressed={accentColor === "green"}
									>
										<span className="block size-full rounded-full bg-[#25f46a]" />
									</button>
									<button
										type="button"
										onClick={() => handleAccentChange("blue")}
										className={`size-4 rounded-full border transition-all ${
											accentColor === "blue"
												? "border-primary/70 ring-2 ring-primary/40"
												: "border-border/70 hover:border-primary/40"
										}`}
										aria-label="Set accent color to blue"
										aria-pressed={accentColor === "blue"}
									>
										<span className="block size-full rounded-full bg-[#3b82f6]" />
									</button>
									<button
										type="button"
										onClick={() => handleAccentChange("red")}
										className={`size-4 rounded-full border transition-all ${
											accentColor === "red"
												? "border-primary/70 ring-2 ring-primary/40"
												: "border-border/70 hover:border-primary/40"
										}`}
										aria-label="Set accent color to red"
										aria-pressed={accentColor === "red"}
									>
										<span className="block size-full rounded-full bg-[#ef4444]" />
									</button>
								</div>
								<span className="ml-2 text-primary text-xs">$ ANALYSIS OUTPUT</span>
							</div>
							<div className="space-y-1 text-xs min-h-30">
								{displayedText.map((line, index) => (
									<p
										key={index}
										className={`${getLineColor(index, line)} ${
											line.includes("service:") ? "opacity-60" : ""
										}`}
									>
										{line}
										{index === currentLineIndex && (
											cursorVisible && (
												<span>▋</span>
											)
										)}
									</p>
								))}
							</div>
						</div>
					</div>
				</div>

				{/* Partner Logos */}
				<div className="max-w-7xl mx-auto mt-20 pt-12 border-t border-border/50">
					<p className="text-center text-muted-foreground text-xs uppercase tracking-wider mb-8">
						POWERED BY ELITE INFRASTRUCTURE TEAMS
					</p>
					<div className="flex flex-wrap items-center justify-center gap-12 opacity-50">
						<div className="font-bold text-xl">AWS</div>
						<div className="font-bold text-xl">GCP</div>
						<div className="font-bold text-xl">VERCEL</div>
					</div>
				</div>
			</section>
			{/* The SmartDeploy Flow */}
			<section id="how-it-works" className="px-6 lg:px-12 py-20 bg-muted/20 border-y border-border/50">
				<div className="max-w-7xl mx-auto">
					<p className="text-primary font-mono text-xs uppercase tracking-wider text-center mb-2">
						QUESTION FROM // PIPELINE
					</p>
					<h2 className="text-4xl lg:text-5xl font-bold text-center mb-3">
						THE SMARTDEPLOY FLOW
					</h2>
					<p className="text-center text-muted-foreground mb-16">
						Simplified orchestration from source to production.
					</p>

					<div className="grid md:grid-cols-2 lg:grid-cols-4 gap-8">
						{/* Step 1 */}
						<div className="flex flex-col gap-4">
							<div className="size-16 rounded-lg bg-primary/10 border border-primary/30 flex items-center justify-center">
								<GitBranch className="size-8 text-primary" />
							</div>
							<h3 className="text-xl font-bold">01. Connect Repo</h3>
							<p className="text-sm text-muted-foreground">
								Connect any GitHub repository with OAuth. Works instantly with public and private repositories.
							</p>
						</div>

						{/* Step 2 */}
						<div className="flex flex-col gap-4">
							<div className="size-16 rounded-lg bg-primary/10 border border-primary/30 flex items-center justify-center">
								<Scan className="size-8 text-primary" />
							</div>
							<h3 className="text-xl font-bold">02. AI Project Scan</h3>
							<p className="text-sm text-muted-foreground">
								Metadata-based AI detects infrastructure requirements and generates configurations automatically.
							</p>
						</div>

						{/* Step 3 */}
						<div className="flex flex-col gap-4">
							<div className="size-16 rounded-lg bg-primary/10 border border-primary/30 flex items-center justify-center">
								<Package className="size-8 text-primary" />
							</div>
							<h3 className="text-xl font-bold">03. Automated Build</h3>
							<p className="text-sm text-muted-foreground">
								Selects optimal provisioning across AWS, GCP, and Azure for instant cloud delivery.
							</p>
						</div>

						{/* Step 4 */}
						<div className="flex flex-col gap-4">
							<div className="size-16 rounded-lg bg-primary/10 border border-primary/30 flex items-center justify-center">
								<Rocket className="size-8 text-primary" />
							</div>
							<h3 className="text-xl font-bold">04. Instant Deployment</h3>
							<p className="text-sm text-muted-foreground">
								Deploy at scale with real-time logs and monitoring. Zero downtime, maximum efficiency.
							</p>
						</div>
					</div>
				</div>
			</section>

			{/* Tech Specs */}
			<section id="features" className="px-6 lg:px-12 py-20">
				<div className="max-w-7xl mx-auto">
					<div className="grid lg:grid-cols-5 gap-12 mb-16">
						{/* Left Side */}
						<div className="lg:col-span-2 flex flex-col gap-6">
							<h2 className="text-4xl lg:text-5xl font-bold">
								TECH<br />SPECS
							</h2>
							<p className="text-muted-foreground">
								Production-grade at the YAML level.<br />
								Pure engineering, zero friction.
							</p>
							<div className="space-y-2 font-mono text-sm">
								<p className="text-primary">HTML/SLA: <span className="text-foreground">99.99%</span></p>
								<p className="text-primary">AVAILABILITY: <span className="text-foreground">&lt;10ms</span></p>
							</div>
						</div>

						{/* Right Side - Feature Grid */}
						<div className="lg:col-span-3 grid gap-6">
							{/* Feature 1 */}
							<div className="bg-card border border-border/50 rounded-lg p-6">
								<div className="flex items-start gap-4">
									<div className="size-12 shrink-0 rounded-lg bg-primary/10 border border-primary/30 flex items-center justify-center">
										<Scan className="size-6 text-primary" />
									</div>
									<div>
										<h3 className="font-mono text-sm font-bold mb-2">01_AUTO_SCAN</h3>
										<p className="text-sm text-muted-foreground">
											AI analysis of IOT to determine infrastructure requirements and metadata.
										</p>
									</div>
								</div>
							</div>

							{/* Feature 2 */}
							<div className="bg-card border border-border/50 rounded-lg p-6">
								<div className="flex items-start gap-4">
									<div className="size-12 shrink-0 rounded-lg bg-primary/10 border border-primary/30 flex items-center justify-center">
										<span className="text-primary text-2xl">⚡</span>
									</div>
									<div>
										<h3 className="font-mono text-sm font-bold mb-2">02_MULTI_REGION</h3>
										<p className="text-sm text-muted-foreground">
											Replicate fault-cloud provisioning AWS, GCP, and Azure as a single target.
										</p>
									</div>
								</div>
							</div>

							{/* Feature 3 */}
							<div className="bg-card border border-border/50 rounded-lg p-6">
								<div className="flex items-start gap-4">
									<div className="size-12 shrink-0 rounded-lg bg-primary/10 border border-primary/30 flex items-center justify-center">
										<span className="text-primary text-2xl">▦</span>
									</div>
									<div>
										<h3 className="font-mono text-sm font-bold mb-2">03_DB_MESH</h3>
										<p className="text-sm text-muted-foreground">
											Database provisioning with advanced point-in-time recovery.
										</p>
									</div>
								</div>
							</div>

							{/* Feature 4 */}
							<div className="bg-card border border-border/50 rounded-lg p-6">
								<div className="flex items-start gap-4">
									<div className="size-12 shrink-0 rounded-lg bg-primary/10 border border-primary/30 flex items-center justify-center">
										<span className="text-primary text-2xl">⚙</span>
									</div>
									<div>
										<h3 className="font-mono text-sm font-bold mb-2">04_STREAM_LOGS</h3>
										<p className="text-sm text-muted-foreground">
											Real-time developer event pipeline logs exported via standard websockets.
										</p>
									</div>
								</div>
							</div>
						</div>
					</div>
				</div>
			</section>
			{/* CTA Section */}
			<section className="px-6 lg:px-12 py-20 bg-muted/20">
				<div className="max-w-4xl mx-auto">
					<div className="bg-linear-to-br from-primary/20 to-primary/10 border-4 border-primary/50 rounded-2xl p-12">
						<div className="bg-black rounded-xl p-8 lg:p-12">
							<h2 className="text-3xl lg:text-4xl font-bold text-center mb-8">
								Ready to Initialize?
							</h2>
							<div className="bg-gray-900 border border-primary/30 rounded-lg p-6 mb-8 font-mono text-sm lg:text-base">
								<p className="text-primary">
									$ npx smartdeploy init --project-name=my-big-thing
								</p>
							</div>
							<div className="flex flex-wrap justify-center gap-4">
								<Link
									href="/auth"
									className="bg-primary hover:bg-primary/90 text-primary-foreground font-mono font-medium px-8 py-3 rounded-md transition-all"
								>
									START_YOUR_BUILD
								</Link>
								<Link
									href="#contact"
									className="bg-muted hover:bg-muted/80 text-foreground font-mono font-medium px-8 py-3 rounded-md transition-all"
								>
									CONTACT_SUPPORT@DEPLOY.AI
								</Link>
							</div>
						</div>
					</div>
				</div>
			</section>
{/* Footer */}
			<footer className="border-t border-border/50 py-16 px-6 lg:px-12">
				<div className="max-w-7xl mx-auto">
					<div className="grid md:grid-cols-2 lg:grid-cols-5 gap-12 mb-12">
						{/* Branding */}
						<div className="lg:col-span-2">
							<SmartDeployLogo href="/" className="mb-4" />
							<p className="text-muted-foreground text-sm mb-6 max-w-sm">
								The ultimate standard for cloud automation. Infra-as-code, scale at will.
							</p>
							<div className="flex items-center gap-4">
								<a href="#" className="text-muted-foreground hover:text-foreground transition-colors">
									<Github className="size-5" />
								</a>
								<a href="#" className="text-muted-foreground hover:text-foreground transition-colors">
									<Twitter className="size-5" />
								</a>
								<a href="#" className="text-muted-foreground hover:text-foreground transition-colors">
									<Linkedin className="size-5" />
								</a>
							</div>
						</div>

						{/* Product */}
						<div>
							<h4 className="font-semibold mb-4">Product</h4>
							<ul className="space-y-3 text-sm text-muted-foreground">
								<li><Link href="#features" className="hover:text-foreground transition-colors">Features</Link></li>
								<li><Link href="#how-it-works" className="hover:text-foreground transition-colors">How It Works</Link></li>
								<li><Link href="#" className="hover:text-foreground transition-colors">Changelog</Link></li>
								<li><Link href="#" className="hover:text-foreground transition-colors">Roadmap</Link></li>
							</ul>
						</div>

						{/* Resources */}
						<div>
							<h4 className="font-semibold mb-4">Resources</h4>
							<ul className="space-y-3 text-sm text-muted-foreground">
								<li><Link href="#docs" className="hover:text-foreground transition-colors">Documentation</Link></li>
								<li><Link href="#" className="hover:text-foreground transition-colors">Blog</Link></li>
								<li><Link href="#" className="hover:text-foreground transition-colors">Guides</Link></li>
								<li><Link href="#" className="hover:text-foreground transition-colors">API Reference</Link></li>
							</ul>
						</div>

						{/* Company */}
						<div>
							<h4 className="font-semibold mb-4">Company</h4>
							<ul className="space-y-3 text-sm text-muted-foreground">
								<li><Link href="#" className="hover:text-foreground transition-colors">About Us</Link></li>
								<li><Link href="#" className="hover:text-foreground transition-colors">Careers</Link></li>
								<li><Link href="#" className="hover:text-foreground transition-colors">Contact</Link></li>
								<li><Link href="#" className="hover:text-foreground transition-colors">Privacy Policy</Link></li>
							</ul>
						</div>
					</div>

					{/* Bottom Bar */}
					<div className="pt-8 border-t border-border/50 flex flex-col md:flex-row items-center justify-between gap-4">
						<p className="text-sm text-muted-foreground">
							© 2026 SmartDeploy Inc. All rights reserved.
						</p>
						<div className="flex items-center gap-2 text-sm">
							<CheckCircle className="size-4 text-primary" />
							<span className="text-primary font-medium">ALL SYSTEMS OPERATIONAL</span>
						</div>
					</div>
				</div>
			</footer>
		</div>
	);
}


