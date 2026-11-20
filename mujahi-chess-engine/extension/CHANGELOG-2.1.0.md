# Chess Helper 2.1.0 — Engine provider switch + MUJAHI API

## Added
- Engine Settings gear in the panel header with three switchable providers persisted in `localStorage` (`ch_engine_provider`):
  - **Hosted API** (`api`, StockfishOnline default)
  - **MUJAHI API** (`mujahi`, MUJAHI Stockfish 19 Render backend with MV3 background service worker and SSE streaming)
  - **Local WASM** (`wasm`, Stockfish.js 19.0.1 Lite single-threaded UCI worker)
- Manifest V3 background service worker (`engine/mujahi-background.js`) and provider adapter (`engine/mujahi-provider.js`) supporting progressive depth batching (D5 -> D10 -> D15) and instant cancellation when board positions change.
- Clean icon fallback (`images/icon.svg`) if `images/xndroid.jpg` is absent.

## Preserved
- StockfishOnline API provider (`api`) as default and its host permission.
- Local WASM (`wasm`) host bridge and UCI search coordinator.
- SuperMode board overlays, arrows (D5/D10/D15), mate alerts, evaluation bar, autoplay, freemium move counter/keys, Lichess integrations, and Xndroid endpoints.
