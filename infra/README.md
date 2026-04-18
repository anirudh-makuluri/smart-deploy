# Infra Layout

- [aws-worker](aws-worker) is the update-existing setup tied to the live worker state.
- [aws-worker-new](aws-worker-new) is the fresh-instance setup for creating a brand-new worker with its own state.

Use the existing stack when you want to change the live instance in place. Use the new stack when you want a second worker or a clean deployment path.
