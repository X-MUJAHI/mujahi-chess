# Chess Helper 2.1.2 — Auto-play source randomization

## Added
- Moved the existing **Auto-play arrow** selector from the main panel into the existing Settings gear overlay.
- Added **Random — Blue / Teal**, which randomly chooses between the Blue (D5) and Teal (D10) engine sources for each of the user's turns.
- Random mode uses whichever of Blue and Teal are enabled in the main panel; if only one is enabled, it uses that source. If neither is enabled, no move is auto-played in random mode.
- Changing the selected auto-play source refreshes the current position so the new selection can take effect without waiting for the next position.

## Preserved
- Existing Green (D15), Teal (D10), and Blue (D5) manual source selections.
- Existing auto-play random delay settings and all existing engine / SuperMode settings.
- Existing default selection remains Green (D15) for new installations and installations without a saved selection.
