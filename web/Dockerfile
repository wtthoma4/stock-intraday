# The image of the web application: Nginx serves the built files and sends /api to the API container.
# Build it from the root of the repository, because the npm workspace and the lock file are there:
#   docker build -f web/Dockerfile .
# docker-compose.yml does this for you.

# Stage 1: install the dependencies and build the static files with Vite.
FROM node:22-alpine AS build
WORKDIR /app
# Copy the package files first, so Docker can keep the installed dependencies in its cache.
COPY package.json package-lock.json tsconfig.base.json ./
COPY api/package.json api/
COPY web/package.json web/
RUN npm ci --workspace web --include-workspace-root
COPY web/ web/
RUN npm run build --workspace web

# Stage 2: Nginx without root permissions. This image listens on port 8080, not 80.
FROM nginxinc/nginx-unprivileged:1.27-alpine
COPY web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/web/dist /usr/share/nginx/html
EXPOSE 8080
