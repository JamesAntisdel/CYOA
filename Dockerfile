FROM node:20-bookworm-slim AS dev

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
ENV CI="1"

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    fonts-liberation \
    git \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libglib2.0-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxkbcommon0 \
    libxrandr2 \
    openssl \
    xvfb \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable \
  && corepack prepare pnpm@9.15.0 --activate

WORKDIR /workspace

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/app/package.json apps/app/package.json
COPY convex/package.json convex/package.json
COPY infra/package.json infra/package.json
COPY packages/engine/package.json packages/engine/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/stories/package.json packages/stories/package.json

RUN pnpm install --frozen-lockfile
RUN pnpm --filter @cyoa/app exec playwright install chromium

COPY . .

EXPOSE 8081 19000 19001 19002 3210

CMD ["pnpm", "dev"]
