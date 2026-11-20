# Engine provider modes

Open Chess Helper → **Engine Settings** (gear icon in the panel header).

- **Hosted API** (default): keeps the existing `https://stockfish.online/api/s/v2.php` request path and its internet dependency.
- **MUJAHI API**: connects through the extension's Manifest V3 background worker (`engine/mujahi-background.js`) to your MUJAHI Stockfish 19 backend (`https://mujahi-chess.onrender.com`), streaming D5, D10, and D15 snapshots progressively over `/v1/analyze/stream` without exposing `chess.com` in backend CORS.
- **Local WASM**: starts the bundled Stockfish.js 19.0.1 Lite single-threaded UCI worker inside an extension-origin host frame. No engine HTTP request or API key is used. The worker is created on first analysis and destroyed when switching to Hosted API or MUJAHI API.

## Required Stockfish files (for Local WASM only)

Place the matching upstream release files in `engine/`:

- `engine/stockfish-19-lite-single.js` — 28,230 bytes
- `engine/stockfish-19-lite-single.wasm` — 1,845,971 bytes

Official v19.0.1 release assets:

- https://github.com/nmrugg/stockfish.js/releases/download/v19.0.1/stockfish-19-lite-single.js
- https://github.com/nmrugg/stockfish.js/releases/download/v19.0.1/stockfish-19-lite-single.wasm

## Preserved Bubble Image

The floating button uses `images/xndroid.jpg` when present (copy your binary `images/xndroid.jpg` into `extension/images/xndroid.jpg` if downloading from GitHub without binary uploads) and falls back cleanly to `images/icon.svg` otherwise.

## License

Stockfish.js 19.0.1 and Stockfish 19 (`sf_19`) are GPL-3.0. See `LICENSES/GPL-3.0.txt` and `THIRD_PARTY_NOTICES.md`.
