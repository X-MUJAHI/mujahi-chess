# Chess Helper 2.1.0 (SuperMode) Integration Guide

This guide documents how to add **MUJAHI Stockfish 19 API** (`'mujahi'`) as a **third selectable provider** in **Chess Helper 2.1.0 (SuperMode)** while preserving the existing **`Hosted API` (`'api'`, StockfishOnline default)** and **`Local WASM` (`'wasm'`, Stockfish 19 Lite)** modes untouched.

---

## 1. Architecture Overview

In Chess Helper 2.1.0:
- `ui.js` renders `#ch-engine-settings-overlay` with radio inputs `input[name="ch-engine-provider"]`.
- `engine.js` exposes `getEngineProvider()`, `setEngineProvider(provider)`, `fetchEngineBestMove(fen, depth, signal)`, stores normalized objects in `engineAnalysisCache`, and notifies SuperMode via `handleSuperModeEngineAnalysis(fen, analysis)`.

Adding MUJAHI uses a Manifest V3 background service worker so requests to Render never rely on Chess.com CORS rules (`CORS_ALLOW_EXTENSIONS=true` on the backend explicitly permits `chrome-extension://<id>` service worker origins while continuing to reject `https://www.chess.com`):

```
Chess.com tab (engine.js + examples/extension-provider.js)
   │  chrome.runtime.connect({ name: 'mujahi-analysis-stream' })
   ▼
MV3 Background Service Worker (examples/extension-background.js)
   │  POST https://<render-url>/v1/analyze/stream (authorized by host_permissions + CORS_ALLOW_EXTENSIONS=true)
   ▼
MUJAHI API Container (Stockfish 19 sf_19)
```

---

## 2. Normalized Data Contract

Chess Helper's arrow renderer, eval bar, mate detector, and `handleSuperModeEngineAnalysis` expect `engineAnalysisCache` entries shaped as:

```js
{
  move: "e2e4",          // UCI bestmove
  evaluation: 0.34,      // White-POV pawns (float or null)
  mate: null,            // White-POV mate-in-N moves (integer or null)
  continuation: "e2e4 e7e5 g1f3",
  depth: 10,
  raw: { ... }
}
```

`examples/extension-provider.js` includes `normalizeMujahiSnapshot(snapshot, rawPayload)` which maps MUJAHI's `/v1/analyze` and SSE `snapshot` payloads directly into this structure without altering Chess Helper's downstream UI logic.

---

## 3. Minimal Extension Wiring Steps

1. **Copy adapter files into your extension folder**:
   - `examples/extension-background.js` -> `engine/mujahi-background.js`
   - `examples/extension-provider.js` -> `engine/mujahi-provider.js`

2. **Update `manifest.json`**:
   - Add your Render origin to `host_permissions`: `"https://your-render-service.onrender.com/*"`
   - Add the MV3 background worker:
     ```json
     "background": {
       "service_worker": "engine/mujahi-background.js"
     }
     ```
   - Include `"engine/mujahi-provider.js"` before `"engine.js"` in `content_scripts[0].js`.

3. **Add `'mujahi'` to `engine.js`**:
   - Create a singleton `const mujahiProvider = new window.MujahiExtensionAdapter.MujahiExtensionProvider({ baseUrl: 'https://your-render-service.onrender.com' });`
   - Update `getEngineProvider()` / `setEngineProvider(provider)` to recognize `'api' | 'wasm' | 'mujahi'` (keeping `'api'` as default fallback).
   - Call `mujahiProvider.cancelAll()` inside `setEngineProvider` and when switching positions.
   - Inside `fetchEngineBestMove(fen, depth, signal)`:
     ```js
     if (provider === 'mujahi') {
       return await mujahiProvider.fetchBestMove(fen, depth, signal, (analysis) => {
         const prior = engineAnalysisCache.get(fen);
         if (!prior || analysis.depth >= prior.depth) {
           setBoundedCache(engineAnalysisCache, fen, analysis, 120);
           handleSuperModeEngineAnalysis(fen, analysis);
         }
       });
     }
     ```

4. **Add 3rd radio option in `ui.js` (`#ch-engine-settings-overlay`)**:
   ```html
   <label class="ch-engine-provider-option">
     <input type="radio" name="ch-engine-provider" value="mujahi" ${savedProvider === 'mujahi' ? 'checked' : ''}>
     <span><strong>MUJAHI API</strong><small>Self-hosted Stockfish 19 · Progressive SSE · No Chess.com CORS</small></span>
   </label>
   ```
   Update the `change` listener in `setupButtonEvents()` to allow `'mujahi'` alongside `'api'` and `'wasm'`.
