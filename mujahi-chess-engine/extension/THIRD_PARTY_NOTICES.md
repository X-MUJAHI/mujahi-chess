# Third-party notices

## Stockfish.js 19.0.1 — Stockfish 19 Lite, single-threaded WebAssembly build

- Project: https://github.com/nmrugg/stockfish.js
- Release: https://github.com/nmrugg/stockfish.js/releases/tag/v19.0.1
- NPM package: https://www.npmjs.com/package/stockfish
- License: GNU General Public License v3.0 (GPL-3.0); see `LICENSES/GPL-3.0.txt`.
- Engine assets expected in `engine/`: `stockfish-19-lite-single.js` and `stockfish-19-lite-single.wasm`.

## MUJAHI Chess Engine API (Stockfish 19 `sf_19` Backend Adapter)

- Engine Upstream: https://github.com/official-stockfish/Stockfish/tree/sf_19 (GPL-3.0)
- Server API Protocol: MUJAHI `/v1/analyze` & `/v1/analyze/stream` (SSE) invoked from `engine/mujahi-background.js` over MV3 `host_permissions`.

The engine files are compiled upstream assets and should be included unmodified. When redistributing this extension with those assets, also provide the corresponding source and build information required by GPL-3.0.
