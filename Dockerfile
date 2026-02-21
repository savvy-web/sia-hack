# Stage 1: Install dependencies with pnpm (via corepack in Node image)
FROM node:22-slim AS deps

RUN corepack enable
WORKDIR /app

# Copy workspace config files
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./

# Copy only the packages we need (package.json stubs for install)
COPY pkgs/shared/package.json pkgs/shared/
COPY pkgs/ingestion/package.json pkgs/ingestion/
COPY pkgs/agent/package.json pkgs/agent/

# Install dependencies (skip husky prepare hook)
RUN pnpm install --frozen-lockfile --ignore-scripts

# Stage 2: Runtime with bun
FROM oven/bun:1

WORKDIR /app

# Copy installed node_modules and workspace config from deps stage
COPY --from=deps /app .

# Copy source code (overwrites the package.json-only stubs)
COPY pkgs/shared/ pkgs/shared/
COPY pkgs/ingestion/ pkgs/ingestion/
COPY pkgs/agent/ pkgs/agent/
COPY CHANGELOG.md .

EXPOSE 8080

# Default: run the agent web server
CMD ["bun", "run", "pkgs/agent/src/server.ts"]
