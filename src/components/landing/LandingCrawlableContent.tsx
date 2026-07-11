import Link from "next/link";
import {
	LANDING_AGENT_CAPABILITIES,
	LANDING_DEPLOY_TARGETS,
	LANDING_DESCRIPTION,
	LANDING_FAQ,
	LANDING_FRAMEWORKS,
	LANDING_HERO,
	LANDING_HIGHLIGHTS,
	LANDING_TAGLINE,
	LANDING_WORKFLOW_STEPS,
	formatLandingStatSentence,
} from "@/lib/landing/landingCopy";
import type { LandingPublicStats } from "@/lib/metrics/landingStats";

type LandingCrawlableContentProps = {
	publicStats: LandingPublicStats | null;
};

export function LandingCrawlableContent({ publicStats }: LandingCrawlableContentProps) {
	const statSentence =
		publicStats !== null
			? formatLandingStatSentence(publicStats.totalAnalyses, publicStats.totalDeployments)
			: formatLandingStatSentence(0, 0);

	return (
		<section
			aria-label="Smart Deploy product overview"
			className="sr-only"
			data-testid="landing-crawlable-content"
		>
			<h1>{LANDING_TAGLINE}</h1>
			<p>{LANDING_HERO.ownershipLine}</p>
			<p>{LANDING_DESCRIPTION}</p>
			<p>{statSentence}</p>

			<h2>How Smart Deploy works</h2>
			<ol>
				{LANDING_WORKFLOW_STEPS.map((step) => (
					<li key={step.name}>
						<h3>{step.name}</h3>
						<p>{step.text}</p>
					</li>
				))}
			</ol>

			<h2>Deploy targets</h2>
			<ul>
				{LANDING_DEPLOY_TARGETS.map((target) => (
					<li key={target.name}>
						<h3>{target.name}</h3>
						<p>{target.description}</p>
					</li>
				))}
			</ul>

			<h2>Deployment Agent</h2>
			<ul>
				{LANDING_AGENT_CAPABILITIES.map((capability) => (
					<li key={capability}>{capability}</li>
				))}
			</ul>

			<h2>Why Smart Deploy</h2>
			<ul>
				{LANDING_HIGHLIGHTS.map((highlight) => (
					<li key={highlight}>{highlight}</li>
				))}
			</ul>

			<h2>Frequently asked questions</h2>
			<ul>
				{LANDING_FAQ.map((item) => (
					<li key={item.question}>
						<h3>{item.question}</h3>
						<p>{item.answer}</p>
					</li>
				))}
			</ul>

			<h2>Supported frameworks</h2>
			<p>JavaScript and TypeScript: {LANDING_FRAMEWORKS.javascript.join(", ")}.</p>
			<p>Python: {LANDING_FRAMEWORKS.python.join(", ")}.</p>

			<p>
				<Link href="/docs">Documentation</Link> · <Link href="/auth">Get started</Link> ·{" "}
				<Link href="/llms.txt">llms.txt</Link>
			</p>
		</section>
	);
}
