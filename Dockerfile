# syntax=docker/dockerfile:1

# ================================
# Base stage - shared dependencies
# ================================
FROM node:20-alpine AS base
RUN apk add --no-cache libc6-compat
WORKDIR /app

# ================================
# Build stage (full install so devDependencies e.g. tw-animate-css are available)
# ================================
FROM base AS builder
COPY package.json package-lock.json ./
# Full install including devDependencies required for Next.js/Tailwind build
RUN npm ci

COPY . .

# Build arguments for environment variables needed at build time
ARG NEXT_PUBLIC_WS_URL
ENV NEXT_PUBLIC_WS_URL=$NEXT_PUBLIC_WS_URL

# Increase Node heap for Next.js build (override with --build-arg if build host has less RAM)
ARG NODE_MAX_OLD_SPACE_SIZE=4096
# Build the Next.js application
RUN NODE_OPTIONS="--max-old-space-size=${NODE_MAX_OLD_SPACE_SIZE}" npm run build

# ================================
# Production runner stage
# ================================
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Create non-root user for security
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Copy necessary files from builder
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
