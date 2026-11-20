# Troubleshooting

## 1. First Request Takes 15–50 Seconds on Render Free Tier
Render's Free web service spins down after 15 minutes without HTTP traffic. The first `/health` or `/v1/analyze` request wakes the container and initializes Stockfish 19's `nn-1a298aa575a0.nnue` network in RAM.
- **Fix**: Upgrade to **Starter** (`0.5 vCPU / 512 MB`) for always-on hosting, or wait for `/health` to return `"ready": true` before testing deep searches.

## 2. `CORS_ORIGIN_DENIED` (`403`)
The browser sent an `Origin` header not listed in `CORS_ALLOWED_ORIGINS`.
- **Fix**: Set `CORS_ALLOWED_ORIGINS=https://your-vercel-app.vercel.app` (exact scheme + hostname, no trailing slash) on Render.

## 3. `INVALID_FEN` (`400`)
MUJAHI validates FENs strictly before sending `position fen ...` to Stockfish:
- Both sides must have exactly 1 king, and kings cannot touch.
- Side *not* to move cannot already be in check.
- Pawns cannot sit on rank 1 or rank 8.
- Castling letters (`KQkq`) must match unmoved king/rook coordinates.
- En passant square must sit on rank 3 (Black to move) or rank 6 (White to move) behind an opponent pawn.

## 4. `ENGINE_TIMEOUT` (`504`) on Deep Searches (`depth >= 16`)
On `0.1 vCPU` (Render Free), depths above 14–15 can exceed short timeouts in tactical middlegames.
- **Fix**: Pass a higher `timeoutMs` (up to `ENGINE_MAX_TIMEOUT_MS`, default `180000`) or raise `ENGINE_TIMEOUT_MS` on Render.

## 5. SSE Events Arrive All at Once Instead of Progressively
Some reverse proxies buffer responses unless `X-Accel-Buffering: no` is honored. The API explicitly sets `Cache-Control: no-cache, no-transform` and `X-Accel-Buffering: no`. Ensure your client consumes `text/event-stream` with `ReadableStream` (`fetch`) rather than waiting for `response.text()`.
