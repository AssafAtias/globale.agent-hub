# apps/server/Dockerfile
# Build context: repo root (so npm workspaces install resolves correctly)
# node:22 required — openid-client v6 is pure ESM; Node >=22.12 supports require(ESM)

# ── Build stage ──────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS build
WORKDIR /app

# Copy workspace manifests first (better layer caching)
COPY package.json package-lock.json* ./
COPY apps/server/package.json ./apps/server/

# Install only the server workspace deps (no postinstall scripts from other workspaces)
RUN npm install --workspace=apps/server --ignore-scripts=false

# Copy server source and compile
COPY apps/server/src ./apps/server/src
COPY apps/server/tsconfig.json ./apps/server/
COPY tsconfig.base.json ./

RUN npm run build --workspace=apps/server

# ── Runtime stage ─────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS runtime
# Keep the workspace layout so require() resolution matches the build
WORKDIR /app
ENV NODE_ENV=production

# node_modules lives at workspace root (npm workspaces hoists deps there)
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json

# Server dist + manifest
COPY --from=build /app/apps/server/dist ./apps/server/dist
COPY --from=build /app/apps/server/package.json ./apps/server/package.json

# Ensure migrations folder is present (postbuild already copies them into dist,
# but we make this explicit so the COPY is a clear guarantee)
COPY --from=build /app/apps/server/dist/db/migrations ./apps/server/dist/db/migrations

WORKDIR /app/apps/server

# Run as non-root for security
USER node

EXPOSE 3000
CMD ["node", "dist/index.js"]
