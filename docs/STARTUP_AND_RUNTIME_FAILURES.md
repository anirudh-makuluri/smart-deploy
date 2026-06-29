# Startup and Runtime Failures

These issues appear when the **build succeeded** but the app does not stay healthy — verify fails, ECS tasks exit, or the URL returns 502/503.

## Symptom map

| Symptom | Likely stage |
|---------|--------------|
| Verify step fails | App not responding on probed paths within timeout |
| Deploy `running` then `degraded` | Crashes after initial success |
| ALB 502/503 | No healthy targets — wrong port or crashing process |
| ECS tasks stop repeatedly | Exit on boot — missing env, DB connection, wrong CMD |

Failure code for verify: **`DEPLOYMENT_VERIFICATION_FAILED`**

## Port binding

ECS expects your container to listen on the port from the scan/Railpack plan (commonly `3000` for Node, `8000` for Python).

| Check | Action |
|-------|--------|
| App binds `localhost` only | Bind `0.0.0.0` |
| Hardcoded port | Use `process.env.PORT` or plan port |
| Railpack start command | Must start the server, not just build |

Example:

```javascript
const port = process.env.PORT || 3000;
app.listen(port, '0.0.0.0');
```

## Missing runtime environment

Container starts then exits — check ECS CloudWatch logs for:

- `DATABASE_URL` undefined
- connection refused to Postgres/Redis
- missing API keys

Set vars in Smart Deploy **runtime** env and **redeploy**.

See [Environment Variables](./ENVIRONMENT_VARIABLES.md).

## Wrong start command

Railpack `deploy.startCommand` must match how your app runs in production:

| Mistake | Fix |
|---------|-----|
| `npm run dev` in production | Use `npm run start` or `node dist/index.js` |
| Migrating DB on every boot without DB | Add migrations or fix `DATABASE_URL` |
| SPA static server on wrong path | Point serve command at `dist` or `build` output |

Override in scan results or fix repo scripts.

## Slow cold start

Verification waits up to ~5 minutes. If your app needs longer:

- Optimize startup (lazy init, smaller image)
- Add `/health` that returns 200 only when ready
- Reduce dependencies loaded at boot

See [Health Checks](./HEALTH_CHECKS.md).

## ECS diagnostics on verify failure

Failed verify appends to logs:

- ECS service events (task failed to start, unhealthy target)
- Filtered CloudWatch high-signal lines

Read these before re-running deploy blindly.

## Static sites

Runtime failures are rare — usually wrong S3 content or missing `index.html`:

- 404 on all routes → build output path wrong
- Blank page → JS bundle path wrong for asset prefix

Check `RAILPACK_SPA_OUTPUT_DIR` and build logs.

## Debugging workflow

1. Deployment History → Verify step logs
2. Logs tab → CloudWatch runtime tail
3. Deployment Agent → runtime health (HTTP status, ECS counts)
4. Compare env vars to local `.env` that works
5. Rollback if outage is severe — [History and Rollback](./DEPLOYMENT_HISTORY_AND_ROLLBACK.md)

## Related

- [Health Checks](./HEALTH_CHECKS.md)
- [Runtime Health](./RUNTIME_HEALTH.md)
- [Debugging Deployments](./DEBUGGING_DEPLOYMENTS.md)