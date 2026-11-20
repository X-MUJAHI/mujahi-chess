# API Reference — MUJAHI Chess Engine API

Base URL (production example): `https://mujahi-chess.onrender.com`

All evaluation scores (`evaluation` in pawns, `mate` in moves) are normalized to **White's point of view**:
- Positive (`+1.25` or `mate: 3`) favors White.
- Negative (`-1.25` or `mate: -3`) favors Black.

---

## 1. `GET /health`

Returns container health, Stockfish 19 readiness, active/queued job metrics, and memory RSS.

- Returns `200 OK` when Stockfish is ready or initializing (`status: "ok" | "initializing"`).
- Returns `503 Service Unavailable` if the engine process has entered an unrecoverable `error` state.

---

## 2. `GET /v1/engine`

Returns pinned upstream engine metadata and server configuration limits:
- `tag`: `"sf_19"`
- `commit`: `"edb0d9db6731067ec50ce619ff372b463bc4dd5d"`
- `nnueArchitecture`: `"SFNNv16"`
- `defaultNet`: `"nn-1a298aa575a0.nnue"`
- `configuration`: `{ threads, hashMb, defaultDepth, maxDepth, multiPv, maxQueue, defaultTimeoutMs, maxTimeoutMs }`

---

## 3. `POST /v1/analyze` (Standard JSON)

Runs **one** iterative deepening search up to `Math.max(...depths)` and returns snapshots for every requested depth in a single JSON payload.

### Headers
- `Content-Type: application/json`
- `X-Client-Session-Id: <optional-session-id>` (recommended so subsequent positions from the same user supersede only their own stale jobs)

### Request Body
```json
{
  "fen": "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
  "depths": [5, 10, 15],
  "clientSessionId": "ext_user_tab_1",
  "timeoutMs": 45000
}
```
- `fen` *(required)*: Complete 6-field FEN validated syntactically and semantically before Stockfish receives input.
- `depth` or `depths` *(optional)*: Integer or array of integers `1..ENGINE_MAX_DEPTH`. Defaults to `[ENGINE_DEFAULT_DEPTH]`.
- `clientSessionId` *(optional)*: Alphanumeric/`_`/`-` up to 64 chars. Overrides/falls back to `X-Client-Session-Id`.
- `timeoutMs` *(optional)*: Per-request timeout override clamped by `ENGINE_MAX_TIMEOUT_MS` (`0` disables timeout only if `ENGINE_ALLOW_UNBOUNDED_TIMEOUT=true`).

### Response (`200 OK`)
```json
{
  "success": true,
  "engine": "MUJAHI Stockfish 19",
  "version": "Stockfish 19",
  "tag": "sf_19",
  "commit": "edb0d9db6731067ec50ce619ff372b463bc4dd5d",
  "fen": "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
  "sideToMove": "w",
  "bestmove": "e2e4",
  "ponder": "e7e5",
  "terminal": false,
  "cached": false,
  "deduplicated": false,
  "results": {
    "5": {
      "depth": 5,
      "seldepth": 6,
      "bestmove": "e2e4",
      "evaluation": 0.34,
      "centipawns": 34,
      "mate": null,
      "scoreType": "cp",
      "bound": null,
      "continuation": "e2e4 e7e5 g1f3",
      "nodes": 1850,
      "nps": 185000,
      "timeMs": 10
    }
  }
}
```

---

## 4. `POST /v1/analyze/stream` and `GET /v1/analyze/stream` (Progressive SSE)

Streams each requested depth snapshot immediately over Server-Sent Events as Stockfish completes that ply during the single search.

### `GET /v1/analyze/stream` Query Parameters
`?fen=<url-encoded-fen>&depths=5,10,15&clientSessionId=<id>&timeoutMs=45000`

### SSE Events
1. `event: started` — `{ fen, sideToMove, depths, clientSessionId }`
2. `event: snapshot` — Same object shape as `results[depth]` (fired once per requested depth as reached)
3. `event: complete` — Full response payload identical to `POST /v1/analyze`
4. `event: error` — `{ success: false, error: { code, message } }`

---

## 5. Error Codes

| HTTP Status | `error.code` | Cause |
|---|---|---|
| `400` | `INVALID_FEN` | Malformed syntax, control characters, missing/adjacent kings, opponent king in check, invalid castling or en passant geometry |
| `400` | `INVALID_REQUEST` | Invalid `depths`, `timeoutMs`, or `clientSessionId` |
| `403` | `CORS_ORIGIN_DENIED` | Browser `Origin` not present in `CORS_ALLOWED_ORIGINS` |
| `429` | `RATE_LIMIT_EXCEEDED` | Per-IP rate limit hit |
| `499` | `REQUEST_CANCELLED` | Client disconnected or superseded by a newer FEN from the same `clientSessionId` |
| `503` | `QUEUE_FULL` | Pending queue reached `ENGINE_MAX_QUEUE` |
| `504` | `ENGINE_TIMEOUT` | Search exceeded `timeoutMs` |
