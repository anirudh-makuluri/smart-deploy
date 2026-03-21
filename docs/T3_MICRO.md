# Deploying on t3.micro (1 GB RAM)

t3.micro has only 1 GB RAM. The Next.js Docker build needs more memory, so you must add **swap** on the instance before building.

## One-time setup on EC2

1. **SSH into your instance**, then from the app directory run:

   ```bash
   sudo ./scripts/setup-swap.sh
   ```

   This adds a 2 GB swap file so the build can complete (build will use RAM + swap and may be slower).

2. **Deploy or update as usual:**

   ```bash
   ./scripts/deploy.sh   # first time
   # or
   ./scripts/update.sh   # updates
   ```

## Why this is needed

- `npm run build` (Next.js + TypeScript) can use 1.5–2 GB during the build.
- The default Docker build uses `NODE_MAX_OLD_SPACE_SIZE=2048` (2 GB) so it fits in 1 GB RAM + 2 GB swap.
- If you move to a larger instance (e.g. t3.small), you can set `NODE_MAX_OLD_SPACE_SIZE=4096` in `.env` for faster builds (optional).

## If you already ran deploy without swap

1. Add swap: `sudo ./scripts/setup-swap.sh`
2. Run update again: `./scripts/update.sh`
