FROM node:20-slim AS build
RUN corepack enable
WORKDIR /repo
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY libs ./libs
COPY apps ./apps
COPY scripts ./scripts
RUN pnpm install --frozen-lockfile
ARG APP
RUN pnpm --filter ${APP}... build

FROM node:20-slim
RUN corepack enable
WORKDIR /repo
COPY --from=build /repo ./
ARG APP
ENV APP=${APP}
ENV NODE_ENV=production
CMD ["sh", "-c", "node apps/${APP}/dist/main.js"]
