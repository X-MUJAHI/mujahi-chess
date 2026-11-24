# Chess Helper 2.1.3 — Other good moves

## Added
- Added an independent **Show alternative moves** setting in the main Settings overlay. It works without enabling SuperMode.
- Added a configurable count of 1–4 alternative moves. The extension requests one additional principal variation from Lichess Cloud Eval to account for the best line, then displays the remaining candidate first moves.
- Added a compact **Other good moves** panel card below the depth arrows, with each alternative move and its white-perspective evaluation.
- Added a manual refresh control and bounded in-memory caching.
- Added a single-request flow for Lichess Cloud Eval and a 60-second cooldown after HTTP 429, following Lichess API guidance.
- Added detection for a board-exposed full FEN where available. When the extension has to fall back to piece-DOM reconstruction, the UI warns that castling/en-passant state may be incomplete.

## Preserved
- Existing D5/D10/D15 engine arrows, autoplay source selection, random autoplay delay, provider selection, and SuperMode features.
