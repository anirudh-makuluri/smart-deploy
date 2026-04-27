import { NextResponse } from "next/server";

const LLMSTXT_CONTENT = `# Smart Deploy Documentation

> Smart Deploy docs index for AI agents. Start at /docs for the overview, then use the links below for setup, troubleshooting, and deployment behavior.

## Entry Points
- [Documentation Home](/docs)
- [Changelog](/changelog)

## Core Guides
- [AWS Setup](/docs/aws-setup)
- [Better Auth](/docs/better-auth)
- [Custom Domains](/docs/custom-domains)
- [Error Catalog](/docs/error-catalog)
- [FAQ](/docs/faq)
- [Field Audit](/docs/field-audit)
- [GCP Setup](/docs/gcp-setup)
- [GraphQL Yoga Migration](/docs/graphql-yoga-migration)
- [Help Agent Benchmark](/docs/help-agent-benchmark)
- [Multi Service Detection](/docs/multi-service-detection)
- [Self Hosting](/docs/self-hosting)
- [Supabase Setup](/docs/supabase-setup)
- [Troubleshooting](/docs/troubleshooting)

## Agent Files
- [llms-full.txt](/llms-full.txt)
- [skill.md](/skill.md)
- [MCP endpoint](/mcp)
`;

export async function GET() {
	return new NextResponse(LLMSTXT_CONTENT, {
		status: 200,
		headers: {
			"Content-Type": "text/plain; charset=utf-8",
			"Cache-Control": "public, s-maxage=300, stale-while-revalidate=3600",
		},
	});
}
