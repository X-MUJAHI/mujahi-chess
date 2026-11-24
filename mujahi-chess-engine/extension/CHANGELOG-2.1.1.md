# Chess Helper 2.1.1 — Auto-play timing randomizer

## Added
- Added an optional **Randomize move delay** control inside the existing Settings gear overlay.
- Added editable minimum and maximum delays (0–10000 ms), saved between sessions.
- Selects a fresh independent random delay for each auto-play move; uses the browser crypto random source where available.
- Cancels a pending delayed move when its position becomes stale, the tab is hidden, or auto-play is switched off.

## Preserved
- Existing engine providers, analysis settings, arrows, SuperMode, and board interaction.
- Randomization is off by default, preserving the previous auto-play timing until enabled.
