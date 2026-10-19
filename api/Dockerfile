# The image of the API. Build it from the root of the repository, because the npm workspace and the lock file are there:
#   docker build -f api/Dockerfile .
# docker-compose.yml does this for you.

# Stage 1: install all dependencies and compile the TypeScript code.
FROM node:22-alpine AS build
WORKDIR /app
# Copy the package files first. Docker keeps this layer in its cache until a package file changes,
# so a change to the code does not install the dependencies again.
COPY package.json package-lock.json ./
COPY api/package.json api/
COPY web/package.json web/
# The root workspace has TypeScript, so the build includes it.
RUN npm ci --workspace api --include-workspace-root
COPY tsconfig.base.json ./
COPY api/ api/
RUN npm run build --workspace api

# Stage 2: the runtime image, with only the production dependencies and the compiled code.
FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY api/package.json api/
COPY web/package.json web/
RUN npm ci --workspace api --omit=dev && npm cache clean --force
COPY --from=build /app/api/dist api/dist
# Do not run the API as root. The node image has a user without special permissions.
USER node
EXPOSE 5080
# Docker marks the container as unhealthy if /health does not reply. `wget` is part of Alpine.
# The shell reads PORT when the check runs, so the check uses the same port as the API (5080 if PORT is not set).
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null "http://127.0.0.1:${PORT:-5080}/health" || exit 1
CMD ["node", "--enable-source-maps", "api/dist/server.js"]
