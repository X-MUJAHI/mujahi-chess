# syntax=docker/dockerfile:1

# ==============================================================================
# Stage 1: Compile official Stockfish 19 (sf_19) from source with SFNNv16 NNUE
# ==============================================================================
FROM debian:bookworm-slim AS stockfish-builder

ARG STOCKFISH_REPO=https://github.com/official-stockfish/Stockfish.git
ARG STOCKFISH_TAG=sf_19
ARG STOCKFISH_COMMIT=edb0d9db6731067ec50ce619ff372b463bc4dd5d
# Default x86-64-sse41-popcnt ensures compatibility across Render Free & Starter VMs.
# Override with --build-arg STOCKFISH_ARCH=x86-64-avx2 on Standard/AVX2 instances.
ARG STOCKFISH_ARCH=x86-64-sse41-popcnt

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    g++ \
    git \
    make \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build

RUN git clone --depth 1 --branch "${STOCKFISH_TAG}" "${STOCKFISH_REPO}" Stockfish \
    && cd Stockfish \
    && ACTUAL_COMMIT="$(git rev-parse HEAD)" \
    && echo "Checked out Stockfish commit: ${ACTUAL_COMMIT}" \
    && test "${ACTUAL_COMMIT}" = "${STOCKFISH_COMMIT}"

WORKDIR /build/Stockfish/src

# Verify expected Stockfish 19 SFNNv16 default network macro, fetch & verify net, then compile
RUN grep -q 'nn-1a298aa575a0.nnue' evaluate.h \
    && make net \
    && make -j"$(nproc)" build ARCH="${STOCKFISH_ARCH}" \
    && strip stockfish \
    && printf "uci\nisready\nquit\n" | ./stockfish | grep -q "readyok"

# ==============================================================================
# Stage 2: Install production Node.js 24 LTS dependencies
# ==============================================================================
FROM node:24-bookworm-slim AS node-deps

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# ==============================================================================
# Stage 3: Minimal non-root runtime container
# ==============================================================================
FROM node:24-bookworm-slim AS runtime

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    STOCKFISH_PATH=/usr/local/bin/stockfish

WORKDIR /app

COPY --from=stockfish-builder /build/Stockfish/src/stockfish /usr/local/bin/stockfish
RUN chmod 0755 /usr/local/bin/stockfish

COPY --from=node-deps /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY src ./src

# Run as unprivileged user
RUN groupadd --system mujahi && useradd --system --gid mujahi --no-create-home mujahi \
    && chown -R mujahi:mujahi /app

USER mujahi

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "src/server.js"]
