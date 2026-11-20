# Engine Architecture & Benchmarks (`Stockfish 19`)

## 1. Pinned Upstream Binary

| Property | Value |
|---|---|
| Repository | `https://github.com/official-stockfish/Stockfish` |
| Release Tag | `sf_19` |
| Full Commit SHA | `edb0d9db6731067ec50ce619ff372b463bc4dd5d` |
| NNUE Architecture | `SFNNv16` |
| Default Network File | `nn-1a298aa575a0.nnue` (defined in `src/evaluate.h` `EvalFileDefaultName`; SF19 retired the secondary small net) |
| Build Target | `ARCH=x86-64-sse41-popcnt` (`Dockerfile` `ARG STOCKFISH_ARCH`) |

Development snapshots (`master`) are not used. `api/Dockerfile` checks out the exact pinned commit SHA and runs `make -j"$(nproc)" net` followed by `make -j"$(nproc)" build ARCH="${STOCKFISH_ARCH}"`.

---

## 2. Single-Search Multi-Depth Design

Chess Helper's arrow display requests multiple depths for the same board position (e.g., `5`, `10`, `15`).
Instead of spawning three independent searches (`go depth 5`, `go depth 10`, `go depth 15`), MUJAHI executes **one** search (`go depth 15`) and captures the `info depth <d> ... multipv 1` line at each requested milestone (`5`, `10`, `15`).

Why this helps:
- Eliminates repeated hash-clearing and redundant ply-1..10 tree traversal across separate calls.
- Guarantees depth 5, 10, and 15 snapshots come from a single consistent search tree.
- Works both via `POST /v1/analyze` (returned together) and `POST /v1/analyze/stream` (emitted progressively via SSE as each depth finishes).

No fixed throughput multiplier (such as a guaranteed "3x CPU reduction") is assumed because actual speedup depends on position branching factor, transposition table hits, and host CPU throttling.

---

## 3. Running Measurable Benchmarks

To measure actual multi-depth vs separate-search timing and nodes/sec inside your built Docker container:

```bash
docker exec -it <container-name> npm run bench
```

`api/src/utils/bench.js` runs Stockfish 19 directly against test FENs (opening, middlegame tactical, endgame), executes both:
1. Single search collecting depths `[5, 10, 15]`
2. Three separate sequential searches (`5`, then `10`, then `15`)

It prints real JSON telemetry (`wallMs`, `nodes`, `nps`, `rssMb`) so you can verify exact hardware performance on Render Free (`0.1 vCPU`) vs Render Starter (`0.5 vCPU`) or Standard instances.

---

## 4. Timeout & Crash Recovery

- `ENGINE_TIMEOUT_MS` defaults to `45000` ms (`45s`) with `ENGINE_MAX_TIMEOUT_MS=180000` ms (`180s`), configurable globally via environment variables or per-request via `timeoutMs`.
- When a search is cancelled (`AbortSignal` or client superseding position) or times out:
  1. EngineManager writes `stop` to Stockfish `stdin`.
  2. Waits up to `ENGINE_STOP_GRACE_MS` (default `2000` ms) for Stockfish to emit `bestmove`.
  3. If Stockfish hangs or exits unexpectedly, kills the child process and cleanly restarts a fresh `stockfish` worker before accepting the next queued job.
