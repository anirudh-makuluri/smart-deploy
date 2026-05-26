# Smart Deploy Roadmap

Smart Deploy is becoming a reliable, transparent deployment platform for a focused support matrix.

Current support matrix:

- `Dockerfile` repos
- static sites
- Next.js apps
- React or Vite frontends
- Node.js APIs using Express, NestJS, or Fastify
- Python APIs using FastAPI or Flask

Near-term non-goals:

- Go apps
- Java apps
- arbitrary mixed-language monorepos
- workers, queues, and cron as first-class deploy targets
- broad universal-deploy claims

## Completed Tasks

- [x] Defined the product around transparent deployments, not black-box automation.
- [x] Shipped the blueprint-first flow for reviewing deploy behavior before release.
- [x] Added deploy logs, preview surfaces, and deployment history.
- [x] Added first-class handling for `Dockerfile`, `docker-compose.yml`, and Nginx-based deploy artifacts.
- [x] Shipped the initial repo scan and deployment workspace flow.
- [x] Narrowed the near-term promise to a focused support matrix.

## Next Steps

- [ ] Canonical deployment state machine
  Define one trusted lifecycle for deploy, retry, verify, rollback, pause, and failure states.

- [ ] Automatic rollback on failed rollout
  Roll back automatically when a release fails post-deploy health checks.

- [ ] Structured failure classification
  Classify failures into clear buckets like build, startup, health-check, and infrastructure failure.

- [ ] Framework-aware preflight validation
  Validate build commands, runtime detection, ports, health paths, and deploy artifacts before release starts.

- [ ] Reliable app detection for the support matrix
  Make repo classification deterministic across every supported app type.

- [ ] Unsupported-repo fast exit
  Stop early when a repo falls outside the support matrix and explain why.

- [ ] Normalized deployment model
  Map supported repos into one internal model for build, run, routing, health, and artifact decisions.

- [ ] Blueprint explanation layer
  Explain why Smart Deploy chose a runtime, port, health check, route shape, or artifact.

- [ ] Post-deploy readiness verification
  Mark a deploy successful only after the app is healthy and reachable.

- [ ] Safe retry flow
  Let users retry failed deploys with preserved context and clear next actions.

- [ ] Known-issue auto-fixes
  Add safe, explainable fixes for common supported-app problems like bad ports, missing health checks, static output mistakes, and proxy mismatches.

- [ ] Deploy audit trail
  Record what Smart Deploy generated, changed, retried, and rolled back.

- [ ] Degraded-mode platform behavior
  Keep core product surfaces usable when auth, metrics, or database systems degrade.

- [ ] Rollback drills and failure simulation
  Test rollback paths deliberately so failure handling is proven, not assumed.

- [ ] Supported-app quality gates
  Define release criteria for each supported app type before expanding the matrix.

## Definition Of Done

This roadmap is working when:

- supported apps deploy with minimal manual correction
- failed deploys are easy to understand and recover from
- automatic rollback is standard behavior for bad rollouts
- the blueprint matches real deploy behavior closely
- Smart Deploy is explicit about what it supports and what it does not
