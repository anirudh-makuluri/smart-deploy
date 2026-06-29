# Health Checks

Smart Deploy verifies your app is reachable after deploy and continues probing running deployments for runtime health.

## Post-deploy verification

After ECS rollout (or static publish), the deploy pipeline runs **verification**:

| Setting | Value |
|---------|-------|
| **Paths probed** | `/`, `/health`, `/healthz`, `/api/health` |
| **Success** | HTTP 2xx or 3xx on any path |
| **Window** | Up to ~5 minutes with multiple rounds |
| **On failure** | Deploy status `failed`, code `DEPLOYMENT_VERIFICATION_FAILED` |

Verification logs include ECS service events and filtered CloudWatch excerpts on failure.

## Adding a health endpoint (recommended)

Expose a lightweight route that returns 200 when your app is ready:

```javascript
// Express example
app.get('/health', (_req, res) => res.status(200).send('ok'));
```

```python
# FastAPI example
@app.get("/health")
def health():
    return {"status": "ok"}
```

If your app only serves SPA routes, `/` may return 200 once the server is up — verification can succeed without a dedicated `/health`.

## Database-dependent health

For production-grade checks, verify critical dependencies:

```javascript
app.get('/health', async (_req, res) => {
  await db.ping();
  res.status(200).send('ok');
});
```

Keep checks fast — verification runs repeatedly during the deploy window.

## Static sites

Static S3 deploys verify the public URL serves expected content (HTTP success on probed paths). No container process — ensure `index.html` is at the correct S3 prefix.

## Common verification failures

| Symptom | Likely cause |
|---------|--------------|
| Connection refused | App not listening on `PORT`; container crashed on start |
| 502/503 from ALB | Tasks not healthy; app still starting or wrong port |
| 404 on all paths | Wrong start command or missing build output |
| Timeout | Slow cold start; increase readiness in app or optimize startup |

See [Startup and Runtime Failures](./STARTUP_AND_RUNTIME_FAILURES.md).

## Runtime health (ongoing)

Separate from deploy verification, a background reconciler probes **running** deployments every ~10 minutes.

See [Runtime Health](./RUNTIME_HEALTH.md).

## Related

- [Deployment Pipeline](./DEPLOYMENT_PIPELINE.md)
- [Debugging Deployments](./DEBUGGING_DEPLOYMENTS.md)
- [Error Catalog](./ERROR_CATALOG.md) — `DEPLOYMENT_VERIFICATION_FAILED`