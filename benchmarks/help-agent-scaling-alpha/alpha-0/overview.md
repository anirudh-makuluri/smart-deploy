# Help Agent Scaling Benchmark Overview

Generated at: 2026-05-05T19:03:06.859Z

Moss reference (from existing benchmark.txt): avg latency 4 ms, avg coverage 87%.

## Run Summary

| Run | Label | Temp Docs | Added Provider | Baseline Avg ms | Baseline Avg Coverage | Moss Avg ms | Moss Avg Coverage | Moss Available |
| --- | --- | ---: | --- | ---: | ---: | ---: | ---: | --- |
| 0 | run-00-baseline | 0 | none | 1 | 82% | 0 | 89% | yes |
| 1 | run-01-render | 120 | render | 6 | 82% | 0 | 77% | yes |
| 2 | run-02-railway | 139 | railway | 7 | 82% | 0 | 77% | yes |
| 3 | run-03-vercel | 319 | vercel | 18 | 84% | 0 | 79% | yes |

## Per-Run Detailed Cases

### Run 0: run-00-baseline

- Temp docs: 0
- Added provider: none
- Output JSON: `benchmarks/help-agent-scaling-alpha/alpha-0/run-00-baseline.json`

#### Target: baseline

| caseId | ms | coverage | chunkCount | topSources | matchedSignals |
| --- | ---: | ---: | ---: | --- | --- |
| deploy-failure-logs | 1 | 25% | 6 | docs/FAQ.md, docs/SUPABASE_SETUP.md, README.md | log |
| local-startup | 1 | 100% | 6 | docs/TROUBLESHOOTING.md, docs/SUPABASE_SETUP.md, README.md | npm install, BETTER_AUTH_SECRET, DATABASE_URL, SUPABASE_URL |
| signin-waitlist | 1 | 67% | 6 | docs/FAQ.md, README.md, docs/SUPABASE_SETUP.md | approved_users, approved |
| github-not-connected | 1 | 100% | 6 | docs/TROUBLESHOOTING.md, docs/FAQ.md, README.md | GitHub not connected, GitHub OAuth, token |
| supabase-connection | 1 | 100% | 6 | docs/TROUBLESHOOTING.md, docs/SUPABASE_SETUP.md, docs/FAQ.md | SUPABASE_URL, DATABASE_URL, schema.sql, relation does not exist |
| websocket-not-connecting | 1 | 100% | 6 | docs/FAQ.md, docs/TROUBLESHOOTING.md, docs/ERROR_CATALOG.md | NEXT_PUBLIC_WS_URL, ws://localhost:4001, wss://, worker |
| aws-permissions | 2 | 75% | 6 | README.md, docs/FAQ.md, docs/ERROR_CATALOG.md | IAM, permissions, AWS_ACCESS_KEY_ID |
| custom-domain | 1 | 75% | 6 | docs/TROUBLESHOOTING.md, docs/ERROR_CATALOG.md, docs/FAQ.md | custom domain, DNS, Vercel |
| self-hosting | 1 | 100% | 6 | docs/TROUBLESHOOTING.md, docs/FAQ.md | reverse proxy, WS_ALLOWED_ORIGINS, NEXT_PUBLIC_WS_URL, self-hosting |
| deploy-health | 1 | 75% | 6 | docs/ERROR_CATALOG.md, docs/SUPABASE_SETUP.md, docs/FAQ.md | health, preview, logs |

#### Target: moss

| caseId | ms | coverage | chunkCount | topSources | matchedSignals |
| --- | ---: | ---: | ---: | --- | --- |
| deploy-failure-logs | 0 | 50% | 6 | help-doc-59, help-doc-203, help-doc-99 | log, permission |
| local-startup | 0 | 100% | 6 | help-doc-199, help-doc-15, help-doc-64 | npm install, BETTER_AUTH_SECRET, DATABASE_URL, SUPABASE_URL |
| signin-waitlist | 0 | 67% | 6 | help-doc-89, help-doc-66, help-doc-46 | approved_users, approved |
| github-not-connected | 0 | 100% | 6 | help-doc-203, help-doc-67, help-doc-42 | GitHub not connected, GitHub OAuth, token |
| supabase-connection | 0 | 100% | 6 | help-doc-197, help-doc-69, help-doc-100 | SUPABASE_URL, DATABASE_URL, schema.sql, relation does not exist |
| websocket-not-connecting | 0 | 100% | 6 | help-doc-92, help-doc-93, help-doc-208 | NEXT_PUBLIC_WS_URL, ws://localhost:4001, wss://, worker |
| aws-permissions | 0 | 100% | 6 | help-doc-211, help-doc-98, help-doc-100 | UnauthorizedOperation, IAM, permissions, AWS_ACCESS_KEY_ID |
| custom-domain | 0 | 100% | 6 | help-doc-96, help-doc-47, help-doc-22 | custom domain, DNS, Vercel, SSL |
| self-hosting | 0 | 100% | 6 | help-doc-210, help-doc-84, help-doc-87 | reverse proxy, WS_ALLOWED_ORIGINS, NEXT_PUBLIC_WS_URL, self-hosting |
| deploy-health | 0 | 75% | 6 | help-doc-5, help-doc-4, help-doc-186 | health, preview, logs |

### Run 1: run-01-render

- Temp docs: 120
- Added provider: render
- Output JSON: `benchmarks/help-agent-scaling-alpha/alpha-0/run-01-render.json`

#### Target: baseline

| caseId | ms | coverage | chunkCount | topSources | matchedSignals |
| --- | ---: | ---: | ---: | --- | --- |
| deploy-failure-logs | 7 | 25% | 6 | temp-docs/TEMP_RENDER_002_render-mcp-server.md, temp-docs/TEMP_RENDER_056_high-availability-for-render-postgres.md, temp-docs/TEMP_RENDER_060_render-platform-maintenance.md | log |
| local-startup | 7 | 100% | 6 | docs/TROUBLESHOOTING.md, docs/SUPABASE_SETUP.md, README.md | npm install, BETTER_AUTH_SECRET, DATABASE_URL, SUPABASE_URL |
| signin-waitlist | 7 | 67% | 6 | docs/FAQ.md, README.md, docs/SUPABASE_SETUP.md | approved_users, approved |
| github-not-connected | 6 | 100% | 6 | docs/TROUBLESHOOTING.md, docs/FAQ.md, temp-docs/TEMP_RENDER_101_cron-jobs.md | GitHub not connected, GitHub OAuth, token |
| supabase-connection | 6 | 100% | 6 | docs/TROUBLESHOOTING.md, docs/SUPABASE_SETUP.md, docs/FAQ.md | SUPABASE_URL, DATABASE_URL, schema.sql, relation does not exist |
| websocket-not-connecting | 5 | 100% | 6 | docs/FAQ.md, docs/TROUBLESHOOTING.md, docs/ERROR_CATALOG.md | NEXT_PUBLIC_WS_URL, ws://localhost:4001, wss://, worker |
| aws-permissions | 6 | 75% | 6 | README.md, docs/FAQ.md, docs/ERROR_CATALOG.md | IAM, permissions, AWS_ACCESS_KEY_ID |
| custom-domain | 5 | 75% | 6 | docs/TROUBLESHOOTING.md, temp-docs/TEMP_RENDER_111_configuring-namecheap-dns.md, temp-docs/TEMP_RENDER_092_configuring-dns-providers.md | custom domain, DNS, Vercel |
| self-hosting | 6 | 100% | 6 | docs/TROUBLESHOOTING.md, docs/FAQ.md | reverse proxy, WS_ALLOWED_ORIGINS, NEXT_PUBLIC_WS_URL, self-hosting |
| deploy-health | 6 | 75% | 6 | docs/ERROR_CATALOG.md, docs/SUPABASE_SETUP.md, temp-docs/TEMP_RENDER_054_best-practices-for-maximizing-uptime.md | health, preview, logs |

#### Target: moss

| caseId | ms | coverage | chunkCount | topSources | matchedSignals |
| --- | ---: | ---: | ---: | --- | --- |
| deploy-failure-logs | 0 | 25% | 6 | help-doc-808, help-doc-251, help-doc-1006 | log |
| local-startup | 0 | 100% | 6 | help-doc-199, help-doc-15, help-doc-64 | npm install, BETTER_AUTH_SECRET, DATABASE_URL, SUPABASE_URL |
| signin-waitlist | 0 | 67% | 6 | help-doc-89, help-doc-66, help-doc-190 | approved_users, approved |
| github-not-connected | 0 | 100% | 6 | help-doc-203, help-doc-90, help-doc-67 | GitHub not connected, GitHub OAuth, token |
| supabase-connection | 0 | 100% | 6 | help-doc-69, help-doc-197, help-doc-34 | SUPABASE_URL, DATABASE_URL, schema.sql, relation does not exist |
| websocket-not-connecting | 0 | 50% | 6 | help-doc-92, help-doc-93, help-doc-1157 | NEXT_PUBLIC_WS_URL, worker |
| aws-permissions | 0 | 100% | 6 | help-doc-211, help-doc-98, help-doc-73 | UnauthorizedOperation, IAM, permissions, AWS_ACCESS_KEY_ID |
| custom-domain | 0 | 50% | 6 | help-doc-1018, help-doc-578, help-doc-1015 | custom domain, DNS |
| self-hosting | 0 | 100% | 6 | help-doc-210, help-doc-84, help-doc-389 | reverse proxy, WS_ALLOWED_ORIGINS, NEXT_PUBLIC_WS_URL, self-hosting |
| deploy-health | 0 | 75% | 6 | help-doc-771, help-doc-883, help-doc-400 | health, preview, logs |

### Run 2: run-02-railway

- Temp docs: 139
- Added provider: railway
- Output JSON: `benchmarks/help-agent-scaling-alpha/alpha-0/run-02-railway.json`

#### Target: baseline

| caseId | ms | coverage | chunkCount | topSources | matchedSignals |
| --- | ---: | ---: | ---: | --- | --- |
| deploy-failure-logs | 7 | 25% | 6 | temp-docs/TEMP_RENDER_002_render-mcp-server.md, temp-docs/TEMP_RENDER_056_high-availability-for-render-postgres.md, temp-docs/TEMP_RENDER_060_render-platform-maintenance.md | log |
| local-startup | 8 | 100% | 6 | docs/TROUBLESHOOTING.md, docs/SUPABASE_SETUP.md, README.md | npm install, BETTER_AUTH_SECRET, DATABASE_URL, SUPABASE_URL |
| signin-waitlist | 8 | 67% | 6 | docs/FAQ.md, README.md, docs/SUPABASE_SETUP.md | approved_users, approved |
| github-not-connected | 7 | 100% | 6 | docs/TROUBLESHOOTING.md, docs/FAQ.md, temp-docs/TEMP_RENDER_101_cron-jobs.md | GitHub not connected, GitHub OAuth, token |
| supabase-connection | 6 | 100% | 6 | docs/TROUBLESHOOTING.md, docs/SUPABASE_SETUP.md, docs/FAQ.md | SUPABASE_URL, DATABASE_URL, schema.sql, relation does not exist |
| websocket-not-connecting | 6 | 100% | 6 | docs/FAQ.md, docs/TROUBLESHOOTING.md, docs/ERROR_CATALOG.md | NEXT_PUBLIC_WS_URL, ws://localhost:4001, wss://, worker |
| aws-permissions | 6 | 75% | 6 | README.md, docs/FAQ.md, docs/ERROR_CATALOG.md | IAM, permissions, AWS_ACCESS_KEY_ID |
| custom-domain | 6 | 75% | 6 | docs/TROUBLESHOOTING.md, temp-docs/TEMP_RENDER_111_configuring-namecheap-dns.md, temp-docs/TEMP_RENDER_092_configuring-dns-providers.md | custom domain, DNS, Vercel |
| self-hosting | 6 | 100% | 6 | docs/TROUBLESHOOTING.md, docs/FAQ.md | reverse proxy, WS_ALLOWED_ORIGINS, NEXT_PUBLIC_WS_URL, self-hosting |
| deploy-health | 7 | 75% | 6 | docs/ERROR_CATALOG.md, docs/SUPABASE_SETUP.md, temp-docs/TEMP_RENDER_054_best-practices-for-maximizing-uptime.md | health, preview, logs |

#### Target: moss

| caseId | ms | coverage | chunkCount | topSources | matchedSignals |
| --- | ---: | ---: | ---: | --- | --- |
| deploy-failure-logs | 0 | 25% | 6 | help-doc-888, help-doc-331, help-doc-1086 | log |
| local-startup | 0 | 100% | 6 | help-doc-199, help-doc-64, help-doc-15 | npm install, BETTER_AUTH_SECRET, DATABASE_URL, SUPABASE_URL |
| signin-waitlist | 0 | 67% | 6 | help-doc-89, help-doc-66, help-doc-190 | approved_users, approved |
| github-not-connected | 0 | 100% | 6 | help-doc-203, help-doc-90, help-doc-67 | GitHub not connected, GitHub OAuth, token |
| supabase-connection | 0 | 100% | 6 | help-doc-69, help-doc-197, help-doc-34 | SUPABASE_URL, DATABASE_URL, schema.sql, relation does not exist |
| websocket-not-connecting | 0 | 50% | 6 | help-doc-92, help-doc-93, help-doc-1237 | NEXT_PUBLIC_WS_URL, worker |
| aws-permissions | 0 | 100% | 6 | help-doc-211, help-doc-98, help-doc-73 | UnauthorizedOperation, IAM, permissions, AWS_ACCESS_KEY_ID |
| custom-domain | 0 | 50% | 6 | help-doc-1098, help-doc-658, help-doc-1095 | custom domain, DNS |
| self-hosting | 0 | 100% | 6 | help-doc-210, help-doc-84, help-doc-469 | reverse proxy, WS_ALLOWED_ORIGINS, NEXT_PUBLIC_WS_URL, self-hosting |
| deploy-health | 0 | 75% | 6 | help-doc-851, help-doc-963, help-doc-853 | health, preview, logs |

### Run 3: run-03-vercel

- Temp docs: 319
- Added provider: vercel
- Output JSON: `benchmarks/help-agent-scaling-alpha/alpha-0/run-03-vercel.json`

#### Target: baseline

| caseId | ms | coverage | chunkCount | topSources | matchedSignals |
| --- | ---: | ---: | ---: | --- | --- |
| deploy-failure-logs | 17 | 25% | 6 | temp-docs/TEMP_RENDER_002_render-mcp-server.md, temp-docs/TEMP_VERCEL_024_runtime-logs.md, temp-docs/TEMP_VERCEL_152_domain-management-for-multi-tenant.md | log |
| local-startup | 19 | 100% | 6 | docs/TROUBLESHOOTING.md, docs/SUPABASE_SETUP.md, README.md | npm install, BETTER_AUTH_SECRET, DATABASE_URL, SUPABASE_URL |
| signin-waitlist | 17 | 67% | 6 | docs/FAQ.md, README.md, docs/SUPABASE_SETUP.md | approved_users, approved |
| github-not-connected | 18 | 100% | 6 | docs/TROUBLESHOOTING.md, docs/FAQ.md, temp-docs/TEMP_RENDER_101_cron-jobs.md | GitHub not connected, GitHub OAuth, token |
| supabase-connection | 17 | 100% | 6 | docs/TROUBLESHOOTING.md, docs/SUPABASE_SETUP.md, docs/FAQ.md | SUPABASE_URL, DATABASE_URL, schema.sql, relation does not exist |
| websocket-not-connecting | 16 | 100% | 6 | docs/FAQ.md, docs/TROUBLESHOOTING.md, docs/ERROR_CATALOG.md | NEXT_PUBLIC_WS_URL, ws://localhost:4001, wss://, worker |
| aws-permissions | 16 | 75% | 6 | README.md, docs/FAQ.md, docs/ERROR_CATALOG.md | IAM, permissions, AWS_ACCESS_KEY_ID |
| custom-domain | 17 | 100% | 6 | docs/TROUBLESHOOTING.md, temp-docs/TEMP_RENDER_111_configuring-namecheap-dns.md, temp-docs/TEMP_RENDER_092_configuring-dns-providers.md | custom domain, DNS, Vercel, SSL |
| self-hosting | 21 | 100% | 6 | docs/TROUBLESHOOTING.md, docs/FAQ.md, temp-docs/TEMP_VERCEL_026_incremental-migration-to-vercel.md | reverse proxy, WS_ALLOWED_ORIGINS, NEXT_PUBLIC_WS_URL, self-hosting |
| deploy-health | 17 | 75% | 6 | docs/ERROR_CATALOG.md, docs/SUPABASE_SETUP.md, temp-docs/TEMP_RENDER_054_best-practices-for-maximizing-uptime.md | health, preview, logs |

#### Target: moss

| caseId | ms | coverage | chunkCount | topSources | matchedSignals |
| --- | ---: | ---: | ---: | --- | --- |
| deploy-failure-logs | 0 | 25% | 6 | help-doc-3383, help-doc-888, help-doc-331 | log |
| local-startup | 0 | 100% | 6 | help-doc-199, help-doc-15, help-doc-64 | npm install, BETTER_AUTH_SECRET, DATABASE_URL, SUPABASE_URL |
| signin-waitlist | 0 | 67% | 6 | help-doc-89, help-doc-66, help-doc-190 | approved_users, approved |
| github-not-connected | 0 | 100% | 6 | help-doc-203, help-doc-90, help-doc-67 | GitHub not connected, GitHub OAuth, token |
| supabase-connection | 0 | 100% | 6 | help-doc-69, help-doc-197, help-doc-100 | SUPABASE_URL, DATABASE_URL, schema.sql, relation does not exist |
| websocket-not-connecting | 0 | 50% | 6 | help-doc-92, help-doc-93, help-doc-1237 | NEXT_PUBLIC_WS_URL, worker |
| aws-permissions | 0 | 100% | 6 | help-doc-211, help-doc-98, help-doc-73 | UnauthorizedOperation, IAM, permissions, AWS_ACCESS_KEY_ID |
| custom-domain | 0 | 100% | 6 | help-doc-1290, help-doc-2045, help-doc-3344 | custom domain, DNS, Vercel, SSL |
| self-hosting | 0 | 75% | 6 | help-doc-3310, help-doc-210, help-doc-84 | reverse proxy, WS_ALLOWED_ORIGINS, NEXT_PUBLIC_WS_URL |
| deploy-health | 0 | 75% | 6 | help-doc-851, help-doc-1779, help-doc-853 | health, preview, logs |

