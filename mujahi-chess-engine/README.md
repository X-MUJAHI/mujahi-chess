# MUJAHI Chess Engine API

Production-oriented self-hosted **Stockfish 19 (`sf_19`)** chess analysis platform structured for zero-CLI web deployment on **GitHub**, **Render.com (Docker)**, and **Vercel**, with **Chess Helper 2.1.0 (SuperMode)** Manifest V3 extension integration.

## Monorepo Layout

```text
mujahi-chess-engine/
├── .github/workflows/ci.yml       # Automated unit tests, Docker SF19 build, live container test & bench
├── api/                           # Node.js 24 LTS + Express + native Stockfish 19 (Render Docker)
├── website/                       # Plain HTML / CSS / Vanilla JS static frontend (Vercel)
├── examples/                      # Chess Helper 2.1.0 MV3 background worker & provider adapter
├── docs/                          # API, Engine, Deployment, Extension, Troubleshooting guides
└── LICENSES/                      # Verbatim Stockfish GPL-3.0 + Third-Party Notices
```

## Key Capabilities

- **Pinned Stockfish 19 (`sf_19`)**: Built from source at commit `edb0d9db6731067ec50ce619ff372b463bc4dd5d` with the official SFNNv16 network (`nn-1a298aa575a0.nnue`).
- **Single-Search Multi-Depth**: Captures or SSE-streams multiple requested depths (`[5, 10, 15]`) from one iterative deepening run.
- **Session-Isolated Scheduler**: `X-Client-Session-Id` enables latest-position-first execution, cancels stale queued/active searches only for the same client, and deduplicates identical FENs across clients.
- **Semantic FEN Guardrails**: Validates rank sums, kings, check legality, castling coordinates, and en passant geometry before touching Stockfish `stdin`.
- **Chess Helper 2.1.0 Compatible**: Preserves `Hosted API` (StockfishOnline) and `Local WASM` while adding `MUJAHI API` over an MV3 service worker.

## Documentation

- [Deployment Guide (GitHub + Render + Vercel)](./docs/DEPLOYMENT.md)
- [API Reference (JSON & SSE)](./docs/API.md)
- [Engine Architecture & Benchmarks](./docs/ENGINE.md)
- [Chess Helper 2.1.0 Integration](./docs/EXTENSION-INTEGRATION.md)
- [Troubleshooting](./docs/TROUBLESHOOTING.md)

## Licensing

- API wrapper, queue, website, and integration examples: **MIT License** (`LICENSE`).
- Stockfish 19 C++ engine and SFNNv16 network: **GNU General Public License v3.0** (`LICENSES/STOCKFISH-LICENSE.txt`). See `LICENSES/THIRD-PARTY-NOTICES.md` for full compliance details.
