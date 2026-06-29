import { NextResponse } from "next/server";

const LLMSTXT_CONTENT = `# Smart Deploy Documentation

> User-facing docs for deploying and debugging apps on Smart Deploy. Start at /docs or docs/README.md.

## Entry Points
- [Documentation Home](/docs)
- [Docs Index (markdown)](/docs/readme)
- [Changelog](/changelog)

## Learn
- [What is Smart Deploy](/docs/what-is-smart-deploy)
- [How It Works](/docs/how-it-works)
- [Getting Started](/docs/getting-started)
- [Glossary](/docs/glossary)

## Deploy
- [Deployment Pipeline](/docs/deployment-pipeline)
- [Blueprint and Preview](/docs/blueprint-and-preview)
- [Smart Analysis](/docs/smart-analysis)
- [Railpack](/docs/railpack)
- [Monorepos and Multi-Service](/docs/monorepos-and-multi-service)
- [Environment Variables](/docs/environment-variables)
- [Custom Domains](/docs/custom-domains)

## Debug
- [Debugging Deployments](/docs/debugging-deployments)
- [Deployment Agent](/docs/deployment-agent)
- [AI Assistance](/docs/ai-assistance)
- [Deployment Logs](/docs/deployment-logs)
- [Health Checks](/docs/health-checks)
- [Runtime Health](/docs/runtime-health)
- [Deployment History and Rollback](/docs/deployment-history-and-rollback)
- [Build Failures](/docs/build-failures)
- [Startup and Runtime Failures](/docs/startup-and-runtime-failures)
- [Domain and TLS Issues](/docs/domain-and-tls-issues)

## Reference
- [FAQ](/docs/faq)
- [Error Catalog](/docs/error-catalog)
- [Deployment Status Reference](/docs/deployment-status-reference)

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