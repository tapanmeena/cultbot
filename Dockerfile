# CultBot container image.
# Multi-arch: builds for Raspberry Pi (arm64 / armv7) and x86 home servers.
FROM node:22-alpine

# pnpm ships with Node via corepack.
RUN corepack enable

WORKDIR /app

# Install dependencies first so this layer is cached until the lockfile changes.
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod

# Application source.
COPY index.js ./
COPY src ./src

# Secrets come from environment variables; application configuration is mounted
# at /app/cultbot.config.yaml or supplied through CULTBOT_CONFIG_YAML.
# Default command runs one booking pass and exits; override the CMD to run other
# subcommands, e.g. `docker run cultbot book --dry-run` or `docker run cultbot doctor`.
ENTRYPOINT ["node", "index.js"]
CMD ["book"]
