# Help Agent Benchmark

This benchmark compares the current help-agent retriever against a Moss-backed candidate on the same troubleshooting prompts.

## What it measures

- Retrieval quality: whether the top returned context includes the expected troubleshooting signals.
- Latency: time spent retrieving context for each prompt.
- Practical fit: how many docs/chunks are returned and whether the candidate is easy to plug in.

## Baseline

The baseline uses the current help-agent retrieval path in `src/lib/helpAgentDocs.ts`.

## Candidate

The candidate is a Moss-backed retrieval endpoint or adapter.

The runner expects the candidate endpoint to accept:

```json
{
  "question": "Why did my recent deployment fail?",
  "history": []
}
```

and return either:

```json
{
  "docs": [{ "source": "docs/TROUBLESHOOTING.md", "section": "Deploy fails", "content": "...", "score": 0.98 }]
}
```

or a compatible `results` / `items` array with the same fields.

## Prompts

The prompt set lives in `benchmarks/help-agent-benchmark.prompts.json` and includes:

- deployment failures
- startup issues
- auth and approval flow issues
- GitHub connection problems
- Supabase and schema issues
- WebSocket connectivity problems
- AWS permission issues
- custom domain / self-hosting issues

## Run it

```bash
npm run benchmark:help-agent
```

Optional candidate comparison:

```bash
MOSS_BENCHMARK_URL=http://localhost:8080/api/retrieve npm run benchmark:help-agent
```

Direct Moss mode (SDK):

```bash
MOSS_PROJECT_ID=<your_project_id> MOSS_PROJECT_KEY=<your_project_key> npm run benchmark:help-agent
```

If `MOSS_BENCHMARK_URL` is not set, the runner tries direct Moss SDK mode automatically.

Debug mode:

```bash
HELP_AGENT_BENCHMARK_DEBUG=1 npm run benchmark:help-agent
```

Keep the temporary Moss index (for dashboard inspection):

```bash
KEEP_MOSS_INDEX=1 HELP_AGENT_BENCHMARK_DEBUG=1 npm run benchmark:help-agent
```

Optional JSON output:

```bash
HELP_AGENT_BENCHMARK_OUT=benchmarks/help-agent-benchmark-results.json npm run benchmark:help-agent
```

## Decision rule

Adopt Moss only if it clearly improves one of the following without adding too much complexity:

- retrieval quality on real troubleshooting prompts
- latency at the retrieval layer
- scalability or maintainability of the retrieval stack

If Moss is only roughly equal, keep the current implementation.