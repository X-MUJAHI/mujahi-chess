# Chess Helper 2.1.4 — MUJAHI API Fixes + SuperMode Pro Insights

## Fixed
- Fixed `normalizeMujahiSnapshot()` to extract centipawn object evaluations (`{ type: "cp", value, rawCp }`), `pv[]` continuations, `ponder`, `nodes`, `nps`, `time`, and `bound` from MUJAHI Stockfish 19 API responses.
- Fixed array-based `results` lookup (`[{ depth, ... }]`) and early forced-mate completion fallback in `engine/mujahi-provider.js`.
- Added live **Test MUJAHI** health check indicator inside Settings (`⚙`) and graceful handling for transient mid-drag `INVALID_FEN` frames and CORS diagnostics.

## Added (Configurable in SuperMode Settings)
- **Expected reply (Ponder)**: Visualizes the opponent's likely response (`ponder`) with an amber dashed arrow and HUD tag without clashing with primary arrows.
- **PV continuation line**: Renders multi-move PV continuation steps (`2`, `3`, `4`...) on target squares and HUD summary (configurable 2–5 plies).
- **Depth consensus / Trap alert**: Compares progressive D5 vs D10/D15 snapshots to flag locked agreement or shallow-depth tactical traps.
- **Win % chance**: Computes Stockfish empirical win probability from exact centipawns (`rawCp`) / mate scores.
- **Engine telemetry (NPS)**: Shows Stockfish 19 depth/seldepth, NPS, search time, cache status (`CACHED`), and evaluation bounds.
- **Eval sparkline & ACPL Session Review**: Live board-corner evaluation momentum sparkline and ACPL summary inside SuperMode review.
- **SuperMode Display Options**: Configurable PV step count (2–5 plies), board HUD corner (`Top-left` / `Bottom-left`), Ultra-compact HUD mode, and one-click overlay reset.

## Preserved
- All 2.1.3 features: Hosted API (`api`) default, Local WASM (`wasm`), Other good moves (Lichess Cloud Eval), Auto-play source (`random-blue-teal`), and Auto-play delay randomizer.
- Clean default board state: all new SuperMode overlays default to OFF until enabled in SuperMode Settings.
