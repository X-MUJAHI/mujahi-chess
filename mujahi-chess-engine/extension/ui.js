// --- CONFIG & STATE ---
const _savedD15 = parseInt(localStorage.getItem('ch_depth_d15') || '15');
const _savedD10 = parseInt(localStorage.getItem('ch_depth_d10') || '10');
const _savedD5  = parseInt(localStorage.getItem('ch_depth_d5')  || '5');
const _savedShowD15 = localStorage.getItem('ch_show_d15') !== 'false';
const _savedShowD10 = localStorage.getItem('ch_show_d10') !== 'false';
const _savedShowD5  = localStorage.getItem('ch_show_d5')  !== 'false';
const _savedAutoplayArrowRaw = localStorage.getItem('ch_autoplay_arrow') || 'd15';
const _savedAutoplayArrow = ['d15', 'd10', 'd5', 'random-blue-teal'].includes(_savedAutoplayArrowRaw)
    ? _savedAutoplayArrowRaw
    : 'd15';
function readAutoplayDelay(key, fallback) {
    const parsed = Number.parseInt(localStorage.getItem(key) || '', 10);
    return Number.isFinite(parsed) ? Math.max(0, Math.min(10000, parsed)) : fallback;
}
const _savedAutoplayRandomizerEnabled = localStorage.getItem('ch_autoplay_randomizer_enabled') === 'true';
const _savedAutoplayDelayMin = readAutoplayDelay('ch_autoplay_delay_min', 350);
const _savedAutoplayDelayMax = Math.max(_savedAutoplayDelayMin, readAutoplayDelay('ch_autoplay_delay_max', 1400));
function readIntRange(key, fallback, min, max) {
    const parsed = Number.parseInt(localStorage.getItem(key) || '', 10);
    return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}
const _savedSoftMistakesMinCp = readIntRange('ch_soft_mistakes_min_cp', 25, 10, 300);
const _savedSoftMistakesMaxCp = Math.max(_savedSoftMistakesMinCp, readIntRange('ch_soft_mistakes_max_cp', 85, 20, 400));
const _savedSoftMistakesCount = readIntRange('ch_soft_mistakes_count', 3, 1, 4);
function normalizeEngineProvider(provider) {
    if (provider === 'wasm') return 'wasm';
    if (provider === 'mujahi') return 'mujahi';
    return 'api';
}
const _savedEngineProvider = normalizeEngineProvider(localStorage.getItem('ch_engine_provider'));

const SUPER_MODE_FEATURES = [
    { key: 'material', label: 'Material advantage', group: 'On-board overlays' },
    { key: 'captured', label: 'Material balance', group: 'On-board overlays' },
    { key: 'hanging', label: 'Hanging pieces', group: 'On-board overlays' },
    { key: 'threats', label: 'Attack markers', group: 'On-board overlays' },
    { key: 'activity', label: 'Center control', group: 'On-board overlays' },
    { key: 'evaluation', label: 'Evaluation bar', group: 'Engine insights' },
    { key: 'mate', label: 'Mate alert', group: 'Engine insights' },
    { key: 'ponderArrow', label: 'Expected reply (Ponder)', group: 'Engine insights' },
    { key: 'pvLine', label: 'PV continuation line', group: 'Engine insights' },
    { key: 'depthConsensus', label: 'Depth consensus / Trap', group: 'Engine insights' },
    { key: 'winChance', label: 'Win % chance', group: 'Engine insights' },
    { key: 'moveQuality', label: 'Last-move quality', group: 'Engine insights' },
    { key: 'blunders', label: 'Blunder move alerts', group: 'Engine insights' },
    { key: 'evalDrop', label: 'Small evaluation-drop alerts', group: 'Engine insights' },
    { key: 'softMistakes', label: 'Soft mistake finder', group: 'Engine insights' },
    { key: 'opponentBestMove', label: 'Opponent best move', group: 'Engine insights' },
    { key: 'engineTelemetry', label: 'Engine telemetry (NPS)', group: 'Position lookups' },
    { key: 'evalGraph', label: 'Eval sparkline', group: 'Position lookups' },
    { key: 'alternatives', label: 'Alternative lines', group: 'Position lookups' },
    { key: 'openingExplorer', label: 'Opening Explorer', group: 'Position lookups' },
    { key: 'tablebase', label: 'Endgame tablebase', group: 'Position lookups' },
    { key: 'review', label: 'Session review', group: 'Position lookups' }
];
// One-time v2 migration: begin with a clean, uncluttered board after upgrading from 1.9.
if (localStorage.getItem('ch_supermode_v2_defaults') !== 'true') {
    localStorage.setItem('ch_supermode_enabled', 'false');
    for (const feature of SUPER_MODE_FEATURES) localStorage.setItem(`ch_super_${feature.key}`, 'false');
    localStorage.setItem('ch_supermode_v2_defaults', 'true');
}
const _savedSuperModeFeatures = Object.fromEntries(SUPER_MODE_FEATURES.map(f => [f.key, localStorage.getItem(`ch_super_${f.key}`) === 'true']));

const _savedSuperPvPliesRaw = Number.parseInt(localStorage.getItem('ch_super_pv_plies') || '3', 10);
const _savedSuperPvPlies = Number.isFinite(_savedSuperPvPliesRaw) ? Math.max(2, Math.min(5, _savedSuperPvPliesRaw)) : 3;
const _savedSuperHudCorner = localStorage.getItem('ch_super_hud_corner') === 'bottom-left' ? 'bottom-left' : 'top-left';
const _savedSuperHudCompact = localStorage.getItem('ch_super_hud_compact') === 'true';

window.chessHelper = {
    masterToggle: true,
    autoPlay: false,
    useEngine: true,
    engineProvider: _savedEngineProvider,
    superModeEnabled: localStorage.getItem('ch_supermode_enabled') === 'true',
    superModeFeatures: { ..._savedSuperModeFeatures },
    superModeOptions: {
        pvPlies: _savedSuperPvPlies,
        hudCorner: _savedSuperHudCorner,
        hudCompact: _savedSuperHudCompact
    },
    autoplayArrow: _savedAutoplayArrow,
    autoplayRandomizer: {
        enabled: _savedAutoplayRandomizerEnabled,
        minMs: _savedAutoplayDelayMin,
        maxMs: _savedAutoplayDelayMax
    },
    softMistakes: {
        minDropCp: _savedSoftMistakesMinCp,
        maxDropCp: _savedSoftMistakesMaxCp,
        maxResults: _savedSoftMistakesCount
    },
    arrows: {
        d15: { depth: _savedD15, show: _savedShowD15, color: '#4ade80' },
        d10: { depth: _savedD10, show: _savedShowD10, color: '#2dd4bf' },
        d5:  { depth: _savedD5,  show: _savedShowD5,  color: '#38bdf8' },
    },
    debug: true
};

function log(msg) { if (window.chessHelper.debug) console.log(`[ChessHelper] ${msg}`); }
window.chessHelperLog = log;

let rootEl, bubbleEl, panelEl, modalOverlay;
let uiAbortController = null;
let drag = { active: false, currentX: 0, currentY: 0, initialX: 0, initialY: 0, xOffset: window.innerWidth - 80, yOffset: 80, velocityX: 0, velocityY: 0, lastTime: 0 };

// --- INITIALIZATION ---
function initUI() {
    if (uiAbortController) uiAbortController.abort();
    uiAbortController = new AbortController();
    const oldRoot = document.getElementById('chess-helper-root');
    if (oldRoot) oldRoot.remove();

    rootEl = document.createElement('div');
    rootEl.id = 'chess-helper-root';

    bubbleEl = document.createElement('div');
    bubbleEl.id = 'chess-helper-bubble';
    const iconUrl = (typeof chrome !== 'undefined' && chrome.runtime?.getURL) ? chrome.runtime.getURL('images/xndroid.jpg') : 'images/xndroid.jpg';
    const fallbackIconUrl = (typeof chrome !== 'undefined' && chrome.runtime?.getURL) ? chrome.runtime.getURL('images/icon.svg') : 'images/icon.svg';
    const bubbleImg = document.createElement('img');
    bubbleImg.src = iconUrl;
    bubbleImg.alt = 'Chess Helper';
    bubbleImg.loading = 'eager';
    bubbleImg.decoding = 'async';
    bubbleImg.draggable = false;
    bubbleImg.style.cssText = 'width:100%; height:100%; pointer-events:none; display:block; border-radius: 50%; object-fit: cover;';
    bubbleImg.addEventListener('error', () => {
        if (bubbleImg.src !== fallbackIconUrl) bubbleImg.src = fallbackIconUrl;
    }, { once: true });
    bubbleEl.appendChild(bubbleImg);
    updateBubbleTransform();

    panelEl = document.createElement('div');
    panelEl.id = 'chess-helper-panel';

    const savedEngineSource = localStorage.getItem('ch_use_engine');
    const useEngine = savedEngineSource === null ? true : savedEngineSource === 'true';
    window.chessHelper.useEngine = useEngine;
    if (savedEngineSource === null) localStorage.setItem('ch_use_engine', 'true');
    const savedProvider = normalizeEngineProvider(localStorage.getItem('ch_engine_provider'));
    window.chessHelper.engineProvider = savedProvider;
    if (localStorage.getItem('ch_engine_provider') === null) localStorage.setItem('ch_engine_provider', 'api');

    panelEl.innerHTML = `
        <div class="ch-header" style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
            <div class="ch-title">Chess Assist <span style="font-size: 11px; font-weight: normal; color: var(--ch-text-secondary);">by Mujahi 💝</span></div>
            <div style="display: flex; align-items: center; gap: 8px;">
                <button id="ch-btn-force-refresh" style="background:none; border:none; color:var(--ch-text-secondary); cursor:pointer; padding: 2px; display:flex;" title="Force Engine Refresh">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 21v-5h5"/></svg>
                </button>
                <button id="ch-btn-engine-settings" style="background:none; border:none; color:var(--ch-text-secondary); cursor:pointer; padding:2px 4px; display:flex; font-size:15px; line-height:1;" title="Settings" aria-label="Settings">⚙</button>
                <label class="ch-switch" style="transform: scale(0.7); margin: 0; transform-origin: right;" title="Master Power Switch">
                    <input type="checkbox" id="ch-master-toggle" checked>
                    <span class="ch-slider"></span>
                </label>
            </div>
        </div>

        <div class="ch-row" style="margin-bottom: 12px; margin-top: 10px;">
            <span class="ch-label">Auto-play move</span>
            <label class="ch-switch">
                <input type="checkbox" id="ch-toggle-autoplay">
                <span class="ch-slider"></span>
            </label>
        </div>

        <div class="ch-row" style="margin-bottom: 12px; gap: 10px; align-items: center;">
            <span class="ch-label">Source</span>
            <div style="display: flex; gap: 12px; align-items: center; justify-content: flex-end;">
                <label style="display: inline-flex; align-items: center; gap: 6px; color: var(--ch-text-primary); font-size: 12px; cursor: pointer; user-select: none;">
                    <input type="checkbox" id="ch-toggle-engine" style="margin: 0;">
                    <span>Engine</span>
                </label>
                <label style="display: inline-flex; align-items: center; gap: 6px; color: var(--ch-text-primary); font-size: 12px; cursor: pointer; user-select: none;">
                    <input type="checkbox" id="ch-supermode-toggle" style="margin: 0;">
                    <span style="font-weight:700; color:#a5c7ff;">SuperMode</span>
                </label>
            </div>
        </div>

        <div id="ch-supermode-controls" class="ch-supermode-controls" style="display:none;">
            <div class="ch-supermode-toolbar">
                <span><strong>Live board overlays</strong><small>Insights appear on the chessboard</small></span>
                <button type="button" id="ch-supermode-settings" class="ch-supermode-settings-btn" title="Configure SuperMode overlays" aria-label="Configure SuperMode overlays">⚙</button>
            </div>
        </div>

        <!-- Arrows Section: replaces single depth slider -->
        <div style="background:rgba(0,0,0,0.22); border-radius:12px; padding:10px 12px; border:1px solid rgba(255,255,255,0.06); margin-bottom:14px;">
            <div style="font-size:10px; color:var(--ch-text-secondary); margin-bottom:8px; font-weight:600; letter-spacing:0.06em; text-transform:uppercase;">Arrows</div>

            <!-- d15 row -->
            <div class="ch-row" style="margin-bottom:7px;">
                <div style="display:flex; align-items:center; gap:7px; flex:1;">
                    <span style="width:9px; height:9px; border-radius:50%; flex-shrink:0; background:#4ade80; box-shadow:0 0 5px #4ade8088;"></span>
                    <span style="font-size:11px; color:var(--ch-text-secondary); width:26px;">D</span>
                    <input type="number" id="ch-depth-d15" min="1" max="20" value="${_savedD15}" class="ch-input" style="width:48px; padding:4px 6px; font-size:12px; text-align:center;">
                </div>
                <label class="ch-switch" style="transform:scale(0.72); transform-origin:right; margin:0; flex-shrink:0;">
                    <input type="checkbox" id="ch-show-d15" ${_savedShowD15 ? 'checked' : ''}>
                    <span class="ch-slider"></span>
                </label>
            </div>

            <!-- d10 row -->
            <div class="ch-row" style="margin-bottom:7px;">
                <div style="display:flex; align-items:center; gap:7px; flex:1;">
                    <span style="width:9px; height:9px; border-radius:50%; flex-shrink:0; background:#2dd4bf; box-shadow:0 0 5px #2dd4bf88;"></span>
                    <span style="font-size:11px; color:var(--ch-text-secondary); width:26px;">D</span>
                    <input type="number" id="ch-depth-d10" min="1" max="20" value="${_savedD10}" class="ch-input" style="width:48px; padding:4px 6px; font-size:12px; text-align:center;">
                </div>
                <label class="ch-switch" style="transform:scale(0.72); transform-origin:right; margin:0; flex-shrink:0;">
                    <input type="checkbox" id="ch-show-d10" ${_savedShowD10 ? 'checked' : ''}>
                    <span class="ch-slider"></span>
                </label>
            </div>

            <!-- d5 row -->
            <div class="ch-row" style="margin-bottom:2px;">
                <div style="display:flex; align-items:center; gap:7px; flex:1;">
                    <span style="width:9px; height:9px; border-radius:50%; flex-shrink:0; background:#38bdf8; box-shadow:0 0 5px #38bdf888;"></span>
                    <span style="font-size:11px; color:var(--ch-text-secondary); width:26px;">D</span>
                    <input type="number" id="ch-depth-d5" min="1" max="20" value="${_savedD5}" class="ch-input" style="width:48px; padding:4px 6px; font-size:12px; text-align:center;">
                </div>
                <label class="ch-switch" style="transform:scale(0.72); transform-origin:right; margin:0; flex-shrink:0;">
                    <input type="checkbox" id="ch-show-d5" ${_savedShowD5 ? 'checked' : ''}>
                    <span class="ch-slider"></span>
                </label>
            </div>
        </div>

        <section id="ch-soft-mistakes-card" class="ch-soft-mistakes-card" style="display:none;" title="On-demand slight inaccuracy finder">
            <div class="ch-soft-mistakes-head">
                <strong>Soft mistakes <span id="ch-soft-mistakes-range-label"></span></strong>
                <button type="button" id="ch-btn-find-soft-mistakes" class="ch-soft-mistakes-find-btn" title="Scan on-demand for mild mistakes causing a small evaluation-bar drop">Find</button>
            </div>
            <div id="ch-soft-mistakes-list" class="ch-soft-mistakes-list"><span class="ch-soft-mistakes-status">Click Find when you want mild mistakes</span></div>
        </section>

        <div class="ch-row" style="margin-bottom: 12px;" id="ch-premium-block">
            <span class="ch-label" style="color: #FFD700; display:flex; align-items:center;">
                Human Style 👑 <button class="ch-info-btn" id="ch-human-info">i</button>
            </span>
            <label class="ch-switch">
                <input type="checkbox" id="ch-human-toggle">
                <span class="ch-slider" style="background-color: rgba(255,255,255,0.05); cursor: pointer;"></span>
            </label>
        </div>

        <div class="ch-row" style="margin-bottom: 12px;">
            <span class="ch-label" id="ch-move-counter-text" style="font-size: 12px; color: var(--ch-text-secondary);">Moves: 0/200</span>
            <button class="ch-btn ch-btn-primary" id="ch-btn-get-moves" style="padding: 6px 10px; font-size: 11px; flex: 0 1 auto;">Get Moves</button>
        </div>

        <div id="ch-expandable-section" class="ch-expandable" style="position: relative; padding-top: 24px;">
            <button id="ch-btn-shrink" style="position: absolute; top: 6px; right: 6px; background:none; border:none; color:var(--ch-text-secondary); cursor:pointer; font-size: 14px; padding: 4px; line-height: 1;">✕</button>

            <div id="ch-active-key-display" style="font-size: 11px; color: var(--ch-accent-color); display: none; align-items: center; justify-content: space-between; margin-bottom: 4px;">
                <div style="display: flex; align-items: center;">
                    <span style="color:var(--ch-text-primary);">Key:</span>&nbsp;<span id="ch-active-key-name" style="font-weight:bold;"></span>&nbsp;(<span id="ch-active-key-moves"></span>)
                    <button class="ch-info-btn" id="ch-active-key-info" style="margin-left: 6px; padding:0; height:16px; width:16px; font-size:10px;">i</button>
                </div>
                <button id="ch-active-key-remove" style="background:none; border:none; color: #ff4444; cursor:pointer; font-size: 14px; font-weight: bold; padding: 0 4px;" title="Remove Key">✕</button>
            </div>

            <button class="ch-btn ch-btn-secondary" id="ch-btn-get-key" style="padding: 8px;">1. Get Ad Key (60 Moves)</button>

            <div style="display: flex; gap: 6px;">
                <input type="text" id="ch-key-input" class="ch-input" placeholder="Enter key">
                <button class="ch-btn ch-btn-primary" id="ch-btn-submit-key" style="padding: 0 12px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; font-size: 11px;">
                    Activate
                </button>
            </div>
            <button class="ch-btn ch-btn-primary" id="ch-btn-buy-premium" style="padding: 8px; background: #FFD700; color: #000; font-weight: 800;">BUY PREMIUM</button>
        </div>

        <hr style="border: none; border-top: 1px solid rgba(255,255,255,0.08); margin: 8px 0 16px 0;">

        <div style="text-align: center; font-size: 13px;">
            <p style="margin: 0 0 10px 0; color: var(--ch-text-secondary); font-weight: 500;">Want more pro tools?</p>
            <a href="https://xndroid.store" target="_blank" style="display: block; background: var(--ch-accent-color); color: #121212; padding: 10px; border-radius: 8px; text-decoration: none; font-weight: 700; margin-bottom: 10px; transition: opacity 0.2s;">🚀 Visit xndroid.store</a>
            <a href="https://instagram.com/im_mujahi" target="_blank" style="color: var(--ch-accent-hover); text-decoration: none; font-weight: 500; font-size: 12px;">Follow @im_mujahi on Instagram</a>
        </div>
    `;

    modalOverlay = document.createElement('div');
    modalOverlay.className = 'ch-modal-overlay';
    modalOverlay.id = 'ch-modal-overlay';
    modalOverlay.innerHTML = `
        <div class="ch-modal-box">
            <button class="ch-modal-close" id="ch-modal-close">✕</button>
            <h3 id="ch-modal-title" style="margin-top:0; color: white; font-size: 16px;">Title</h3>
            <p id="ch-modal-text" style="color: var(--ch-text-secondary); font-size: 13px; line-height: 1.5;"></p>
            <button class="ch-btn ch-btn-primary" id="ch-modal-action-btn" style="width: 100%; margin-top: 16px; display: none;">Action</button>
        </div>
    `;

    const superSettingsOverlay = document.createElement('div');
    superSettingsOverlay.className = 'ch-super-settings-overlay';
    superSettingsOverlay.id = 'ch-super-settings-overlay';
    const groupedFeatures = [...new Set(SUPER_MODE_FEATURES.map(feature => feature.group))];
    superSettingsOverlay.innerHTML = `
        <div class="ch-super-settings-sheet" role="dialog" aria-modal="true" aria-labelledby="ch-super-settings-title">
            <div class="ch-super-settings-head">
                <div><strong id="ch-super-settings-title">SuperMode overlays</strong><small>Choose what appears on the board (pointer-events pass through)</small></div>
                <button type="button" id="ch-super-settings-close" aria-label="Close settings">✕</button>
            </div>
            ${groupedFeatures.map(group => `
                <section class="ch-super-settings-group">
                    <div class="ch-super-settings-group-title">${group}</div>
                    <div class="ch-super-settings-grid">
                        ${SUPER_MODE_FEATURES.filter(feature => feature.group === group).map(feature => `
                            <label class="ch-super-feature-chip">
                                <input type="checkbox" data-super-feature="${feature.key}" ${window.chessHelper.superModeFeatures[feature.key] ? 'checked' : ''}>
                                <span>${feature.label}</span>
                            </label>
                        `).join('')}
                    </div>
                </section>
            `).join('')}
            <section class="ch-super-settings-group ch-super-options-group">
                <div class="ch-super-settings-group-title">Display options</div>
                <label class="ch-autoplay-source-field" for="ch-super-pv-plies">
                    <span>PV line length</span>
                    <select id="ch-super-pv-plies" class="ch-autoplay-source-select">
                        ${[2,3,4,5].map(n => `<option value="${n}" ${_savedSuperPvPlies === n ? 'selected' : ''}>${n} plies</option>`).join('')}
                    </select>
                </label>
                <label class="ch-autoplay-source-field" for="ch-super-hud-corner">
                    <span>HUD corner</span>
                    <select id="ch-super-hud-corner" class="ch-autoplay-source-select">
                        <option value="top-left" ${_savedSuperHudCorner === 'top-left' ? 'selected' : ''}>Top-left</option>
                        <option value="bottom-left" ${_savedSuperHudCorner === 'bottom-left' ? 'selected' : ''}>Bottom-left</option>
                    </select>
                </label>
                <label class="ch-autoplay-randomizer-toggle" for="ch-super-hud-compact">
                    <input type="checkbox" id="ch-super-hud-compact" ${_savedSuperHudCompact ? 'checked' : ''}>
                    <span><strong>Compact HUD pills</strong><small>Smaller text and padding to keep board squares clear</small></span>
                </label>
            </section>
            <section class="ch-super-settings-group ch-super-options-group ch-soft-mistakes-settings-group">
                <div class="ch-super-settings-group-title">Soft mistake finder (on-demand)</div>
                <div class="ch-soft-mistakes-settings-options" id="ch-soft-mistakes-settings-options" data-disabled="${window.chessHelper.superModeFeatures.softMistakes ? 'false' : 'true'}">
                    <div class="ch-autoplay-delay-fields" style="margin-top:0; margin-bottom:6px;">
                        <label class="ch-autoplay-delay-field" for="ch-soft-mistakes-min-drop">
                            <span>Min eval drop</span>
                            <span class="ch-autoplay-delay-input-wrap"><input type="number" id="ch-soft-mistakes-min-drop" min="0.10" max="3.00" step="0.05" value="${(_savedSoftMistakesMinCp / 100).toFixed(2)}"><small>pwns</small></span>
                        </label>
                        <label class="ch-autoplay-delay-field" for="ch-soft-mistakes-max-drop">
                            <span>Max eval drop</span>
                            <span class="ch-autoplay-delay-input-wrap"><input type="number" id="ch-soft-mistakes-max-drop" min="0.20" max="4.00" step="0.05" value="${(_savedSoftMistakesMaxCp / 100).toFixed(2)}"><small>pwns</small></span>
                        </label>
                    </div>
                    <label class="ch-autoplay-source-field" for="ch-soft-mistakes-count">
                        <span>Max moves listed</span>
                        <select id="ch-soft-mistakes-count" class="ch-autoplay-source-select">
                            ${[1,2,3,4].map(n => `<option value="${n}" ${_savedSoftMistakesCount === n ? 'selected' : ''}>${n}</option>`).join('')}
                        </select>
                    </label>
                </div>
                <p class="ch-autoplay-delay-note" id="ch-soft-mistakes-settings-note">Enable "Soft mistake finder" above, then click Find on the main panel whenever you want mild mistakes.</p>
            </section>
            <div class="ch-super-settings-actions">
                <button type="button" class="ch-btn ch-btn-secondary" id="ch-supermode-review">Review this session</button>
                <button type="button" class="ch-btn ch-btn-secondary" id="ch-supermode-clear" title="Turn off all SuperMode overlays">Clear all</button>
            </div>
        </div>`;

    const engineSettingsOverlay = document.createElement('div');
    engineSettingsOverlay.className = 'ch-super-settings-overlay';
    engineSettingsOverlay.id = 'ch-engine-settings-overlay';
    engineSettingsOverlay.innerHTML = `
        <div class="ch-super-settings-sheet" role="dialog" aria-modal="true" aria-labelledby="ch-engine-settings-title">
            <div class="ch-super-settings-head">
                <div><strong id="ch-engine-settings-title">Settings</strong><small>Engine and auto-play preferences</small></div>
                <button type="button" id="ch-engine-settings-close" aria-label="Close engine settings">✕</button>
            </div>
            <section class="ch-super-settings-group">
                <div class="ch-super-settings-group-title">Analysis engine</div>
                <label class="ch-engine-provider-option">
                    <input type="radio" name="ch-engine-provider" value="api" ${savedProvider === 'api' ? 'checked' : ''}>
                    <span><strong>Hosted API</strong><small>StockfishOnline · Requires internet · Keeps current behaviour</small></span>
                </label>
                <label class="ch-engine-provider-option">
                    <input type="radio" name="ch-engine-provider" value="mujahi" ${savedProvider === 'mujahi' ? 'checked' : ''}>
                    <span><strong>MUJAHI API</strong><small>MUJAHI Stockfish 19 · Progressive SSE streaming · Dedicated Render host</small></span>
                </label>
                <label class="ch-engine-provider-option">
                    <input type="radio" name="ch-engine-provider" value="wasm" ${savedProvider === 'wasm' ? 'checked' : ''}>
                    <span><strong>Local WASM</strong><small>Stockfish 19 Lite · Runs on this device · Engine files ~1.87 MB</small></span>
                </label>
            </section>
            <div style="display:flex; align-items:center; justify-content:space-between; gap:8px; margin:8px 2px 6px;">
                <span id="ch-mujahi-status" style="font-size:10px; color:var(--ch-text-secondary);">MUJAHI status: ready to test</span>
                <button type="button" id="ch-btn-test-mujahi" class="ch-btn ch-btn-secondary" style="flex:0 0 auto; padding:5px 10px; font-size:10px; border-radius:8px;">Test MUJAHI</button>
            </div>
            <p class="ch-engine-provider-note">Switch anytime between Hosted API, MUJAHI API (progressive D5/D10/D15 SSE stream), or Local WASM (requires the two Stockfish files in <code>engine/</code>).</p>
            <section class="ch-super-settings-group ch-autoplay-source-group">
                <div class="ch-super-settings-group-title">Auto-play move source</div>
                <label class="ch-autoplay-source-field" for="ch-autoplay-arrow">
                    <span>Play the move from</span>
                    <select id="ch-autoplay-arrow" class="ch-autoplay-source-select">
                        <option value="d15" ${_savedAutoplayArrow === 'd15' ? 'selected' : ''}>● Green (D15)</option>
                        <option value="d10" ${_savedAutoplayArrow === 'd10' ? 'selected' : ''}>● Teal (D10)</option>
                        <option value="d5" ${_savedAutoplayArrow === 'd5' ? 'selected' : ''}>● Blue (D5)</option>
                        <option value="random-blue-teal" ${_savedAutoplayArrow === 'random-blue-teal' ? 'selected' : ''}>Random — Blue / Teal</option>
                    </select>
                </label>
                <p class="ch-autoplay-source-note">Random mode chooses Blue (D5) or Teal (D10) independently for each turn. Enable both arrows in the main panel to use both choices.</p>
            </section>
            <section class="ch-super-settings-group ch-autoplay-timing-group">
                <div class="ch-super-settings-group-title">Auto-play timing</div>
                <label class="ch-autoplay-randomizer-toggle" for="ch-autoplay-randomizer-enabled">
                    <input type="checkbox" id="ch-autoplay-randomizer-enabled" ${_savedAutoplayRandomizerEnabled ? 'checked' : ''}>
                    <span><strong>Randomize move delay</strong><small>Choose a fresh delay before each auto-play move</small></span>
                </label>
                <div class="ch-autoplay-delay-fields" id="ch-autoplay-delay-fields" ${_savedAutoplayRandomizerEnabled ? '' : 'data-disabled="true"'}>
                    <label class="ch-autoplay-delay-field" for="ch-autoplay-delay-min">
                        <span>Minimum</span>
                        <span class="ch-autoplay-delay-input-wrap"><input type="number" id="ch-autoplay-delay-min" min="0" max="10000" step="50" value="${_savedAutoplayDelayMin}"><small>ms</small></span>
                    </label>
                    <label class="ch-autoplay-delay-field" for="ch-autoplay-delay-max">
                        <span>Maximum</span>
                        <span class="ch-autoplay-delay-input-wrap"><input type="number" id="ch-autoplay-delay-max" min="0" max="10000" step="50" value="${_savedAutoplayDelayMax}"><small>ms</small></span>
                    </label>
                </div>
                <p class="ch-autoplay-delay-note" id="ch-autoplay-delay-note" aria-live="polite">A new random delay is picked independently for every move.</p>
            </section>
        </div>`;

    rootEl.appendChild(bubbleEl);
    rootEl.appendChild(panelEl);
    rootEl.appendChild(modalOverlay);
    rootEl.appendChild(superSettingsOverlay);
    rootEl.appendChild(engineSettingsOverlay);
    document.body.appendChild(rootEl);

    document.getElementById('ch-toggle-engine').checked = useEngine;
    document.getElementById('ch-supermode-toggle').checked = window.chessHelper.superModeEnabled;
    document.getElementById('ch-supermode-controls').style.display = window.chessHelper.superModeEnabled ? 'block' : 'none';

    setupDragEvents();
    setupButtonEvents();

    if (window.chessHelperEngine?.updateMoveUI) window.chessHelperEngine.updateMoveUI();
    if (window.chessHelperEngine?.refreshSoftMistakesCard) window.chessHelperEngine.refreshSoftMistakesCard();
}

// --- DRAG LOGIC ---
function setupDragEvents() { const signal = uiAbortController?.signal; bubbleEl.addEventListener('mousedown', dragStart, { signal }); document.addEventListener('mouseup', dragEnd, { signal }); document.addEventListener('mousemove', dragMove, { signal, passive: true }); bubbleEl.addEventListener('touchstart', dragStart, { passive: false, signal }); document.addEventListener('touchend', dragEnd, { signal }); document.addEventListener('touchmove', dragMove, { passive: false, signal }); }
function dragStart(e) { if (e.target.closest('#chess-helper-panel')) return; drag.active = true; drag.lastTime = Date.now(); if (e.type === "touchstart") { drag.initialX = e.touches[0].clientX - drag.xOffset; drag.initialY = e.touches[0].clientY - drag.yOffset; } else { drag.initialX = e.clientX - drag.xOffset; drag.initialY = e.clientY - drag.yOffset; } }
function dragEnd(e) { if (!drag.active) return; drag.active = false; startInertia(); }
function dragMove(e) { if (!drag.active) return; e.preventDefault(); let cx = e.type === "touchmove" ? e.touches[0].clientX : e.clientX; let cy = e.type === "touchmove" ? e.touches[0].clientY : e.clientY; drag.currentX = cx - drag.initialX; drag.currentY = cy - drag.initialY; const now = Date.now(); const dt = now - drag.lastTime; if (dt > 0) { drag.velocityX = (drag.currentX - drag.xOffset) / dt; drag.velocityY = (drag.currentY - drag.yOffset) / dt; } drag.lastTime = now; drag.xOffset = drag.currentX; drag.yOffset = drag.currentY; updateBubbleTransform(); if (panelEl.classList.contains('visible')) closePanel(); }
function updateBubbleTransform() { const w = window.innerWidth; const h = window.innerHeight; const size = 52; if (drag.xOffset < 0) drag.xOffset = 0; if (drag.yOffset < 0) drag.yOffset = 0; if (drag.xOffset > w - size) drag.xOffset = w - size; if (drag.yOffset > h - size) drag.yOffset = h - size; bubbleEl.style.transform = `translate3d(${drag.xOffset}px, ${drag.yOffset}px, 0)`; }
function startInertia() { const speed = Math.sqrt(drag.velocityX * drag.velocityX + drag.velocityY * drag.velocityY); if (speed < 0.15) { togglePanel(); return; } function step() { if (drag.active) return; drag.velocityX *= 0.92; drag.velocityY *= 0.92; drag.xOffset += drag.velocityX * 16; drag.yOffset += drag.velocityY * 16; updateBubbleTransform(); if (Math.abs(drag.velocityX) > 0.05 || Math.abs(drag.velocityY) > 0.05) requestAnimationFrame(step); } requestAnimationFrame(step); }

function togglePanel() { panelEl.classList.contains('visible') ? closePanel() : openPanel(); }
function openPanel() { updatePanelPosition(); panelEl.classList.add('visible'); }
function closePanel() { panelEl.classList.remove('visible'); }

function updatePanelPosition() {
    const bubbleRect = bubbleEl.getBoundingClientRect(); const w = window.innerWidth; const h = window.innerHeight;
    const isExpanded = document.getElementById('ch-expandable-section').classList.contains('open');
    const panelW = 280; const panelH = isExpanded ? 560 : 460; const margin = 16; let top, left, originX, originY;
    if (bubbleRect.left > w / 2) { left = bubbleRect.left - panelW - margin; originX = "right"; } else { left = bubbleRect.right + margin; originX = "left"; }
    if (bubbleRect.top > h / 2) { top = bubbleRect.bottom - panelH; originY = "bottom"; } else { top = bubbleRect.top; originY = "top"; }
    if (left < margin) left = margin; if (left + panelW > w - margin) left = w - panelW - margin;
    if (top < margin) top = margin; if (top + panelH > h - margin) top = h - panelH - margin;
    panelEl.style.top = `${top}px`; panelEl.style.left = `${left}px`; panelEl.style.transformOrigin = `${originX} ${originY}`;
}

window.showCustomModal = function (title, text, btnText = null, btnCallback = null) {
    document.getElementById('ch-modal-title').innerText = title;
    document.getElementById('ch-modal-text').innerText = text;
    const btn = document.getElementById('ch-modal-action-btn');
    if (btnText) { btn.style.display = 'block'; btn.innerText = btnText; btn.onclick = () => { if (btnCallback) btnCallback(); modalOverlay.classList.remove('visible'); }; }
    else { btn.style.display = 'none'; }
    modalOverlay.classList.add('visible');
};

// --- BUTTON EVENTS ---
function setupButtonEvents() {
    const signal = uiAbortController?.signal;
    document.getElementById('ch-modal-close').addEventListener('click', () => modalOverlay.classList.remove('visible'), { signal });

    document.getElementById('ch-btn-force-refresh').addEventListener('click', (e) => {
        e.preventDefault();
        e.currentTarget.style.transform = "rotate(180deg)";
        e.currentTarget.style.transition = "transform 0.3s";
        setTimeout(() => { e.target.closest('button').style.transform = "rotate(0deg)"; }, 300);
        if (window.chessHelperEngine?.triggerAutoPlay) window.chessHelperEngine.triggerAutoPlay();
    }, { signal });

    const engineSettingsOverlay = document.getElementById('ch-engine-settings-overlay');
    const closeEngineSettings = () => engineSettingsOverlay.classList.remove('visible');
    const mujahiStatusEl = document.getElementById('ch-mujahi-status');
    const mujahiTestBtn = document.getElementById('ch-btn-test-mujahi');
    const runMujahiHealthCheck = async () => {
        if (!mujahiStatusEl) return;
        mujahiStatusEl.style.color = 'var(--ch-text-secondary)';
        mujahiStatusEl.textContent = 'MUJAHI status: checking...';
        if (mujahiTestBtn) mujahiTestBtn.disabled = true;
        try {
            const res = window.chessHelperEngine?.testMujahiHealth
                ? await window.chessHelperEngine.testMujahiHealth()
                : { ok: false, error: 'Engine helper not ready.' };
            if (res?.ok && res.payload?.engine?.ready) {
                const eng = res.payload.engine;
                mujahiStatusEl.style.color = '#4ade80';
                mujahiStatusEl.textContent = `MUJAHI online · ${eng.version || 'Stockfish 19'} (${eng.tag || 'sf_19'})`;
            } else {
                mujahiStatusEl.style.color = '#f87171';
                mujahiStatusEl.textContent = `MUJAHI error: ${res?.error || res?.payload?.error?.message || `HTTP ${res?.status || 0}`}`;
            }
        } catch (err) {
            mujahiStatusEl.style.color = '#f87171';
            mujahiStatusEl.textContent = `MUJAHI error: ${err?.message || 'Check failed'}`;
        } finally {
            if (mujahiTestBtn) mujahiTestBtn.disabled = false;
        }
    };
    if (mujahiTestBtn) {
        mujahiTestBtn.addEventListener('click', runMujahiHealthCheck, { signal });
    }
    document.getElementById('ch-btn-engine-settings').addEventListener('click', () => {
        engineSettingsOverlay.classList.add('visible');
        if (normalizeEngineProvider(window.chessHelper.engineProvider) === 'mujahi') {
            runMujahiHealthCheck();
        }
    }, { signal });
    document.getElementById('ch-engine-settings-close').addEventListener('click', closeEngineSettings, { signal });
    engineSettingsOverlay.addEventListener('click', (e) => { if (e.target === engineSettingsOverlay) closeEngineSettings(); }, { signal });

    const randomizerToggle = document.getElementById('ch-autoplay-randomizer-enabled');
    const randomizerFields = document.getElementById('ch-autoplay-delay-fields');
    const randomizerMin = document.getElementById('ch-autoplay-delay-min');
    const randomizerMax = document.getElementById('ch-autoplay-delay-max');
    const randomizerNote = document.getElementById('ch-autoplay-delay-note');
    randomizerNote.textContent = _savedAutoplayRandomizerEnabled
        ? `Each move will wait a random ${_savedAutoplayDelayMin}–${_savedAutoplayDelayMax} ms before playing.`
        : 'Random delay is off. Auto-play uses its normal timing.';
    const saveAutoplayRandomizer = () => {
        const minMs = randomizerMin.value.trim() === '' ? NaN : Number(randomizerMin.value);
        const maxMs = randomizerMax.value.trim() === '' ? NaN : Number(randomizerMax.value);
        if (!Number.isInteger(minMs) || !Number.isInteger(maxMs) || minMs < 0 || minMs > 10000 || maxMs < 0 || maxMs > 10000 || minMs > maxMs) {
            randomizerNote.textContent = minMs > maxMs ? 'Minimum must be less than or equal to maximum.' : 'Enter whole-number delays from 0 to 10000 ms.';
            randomizerNote.classList.add('is-error');
            return false;
        }
        const enabled = randomizerToggle.checked;
        window.chessHelper.autoplayRandomizer = { enabled, minMs, maxMs };
        localStorage.setItem('ch_autoplay_randomizer_enabled', String(enabled));
        localStorage.setItem('ch_autoplay_delay_min', String(minMs));
        localStorage.setItem('ch_autoplay_delay_max', String(maxMs));
        randomizerFields.dataset.disabled = String(!enabled);
        randomizerNote.textContent = enabled
            ? `Each move will wait a random ${minMs}–${maxMs} ms before playing.`
            : 'Random delay is off. Auto-play uses its normal timing.';
        randomizerNote.classList.remove('is-error');
        return true;
    };
    randomizerToggle.addEventListener('change', saveAutoplayRandomizer, { signal });
    randomizerMin.addEventListener('change', saveAutoplayRandomizer, { signal });
    randomizerMax.addEventListener('change', saveAutoplayRandomizer, { signal });

    const softMistakesFindBtn = document.getElementById('ch-btn-find-soft-mistakes');
    if (softMistakesFindBtn) {
        softMistakesFindBtn.addEventListener('click', () => {
            if (window.chessHelperEngine?.findSoftMistakes) window.chessHelperEngine.findSoftMistakes();
        }, { signal });
    }

    engineSettingsOverlay.querySelectorAll('input[name="ch-engine-provider"]').forEach(input => {
        input.addEventListener('change', (e) => {
            const provider = normalizeEngineProvider(e.target.value);
            const previous = normalizeEngineProvider(window.chessHelper.engineProvider);
            if (provider === previous) { closeEngineSettings(); return; }
            if (window.chessHelperEngine?.setEngineProvider) window.chessHelperEngine.setEngineProvider(provider);
            else {
                window.chessHelper.engineProvider = provider;
                localStorage.setItem('ch_engine_provider', provider);
            }
            closeEngineSettings();
            const message = provider === 'wasm'
                ? 'Local Stockfish 19 Lite is selected. The engine will load when the next position is analysed. Make sure both Stockfish files are in the extension/engine folder.'
                : provider === 'mujahi'
                    ? 'MUJAHI Stockfish 19 API is selected. Positions will stream progressively (D5/D10/D15) from your MUJAHI Render backend.'
                    : 'StockfishOnline Hosted API is selected. Analysis will use the existing online engine service.';
            window.showCustomModal('Analysis engine changed', message);
        }, { signal });
    });

    document.getElementById('ch-master-toggle').addEventListener('change', (e) => {
        window.chessHelper.masterToggle = e.target.checked;
        if (!e.target.checked) {
            window.clearAllArrows();
            if (window.chessHelperEngine?.refreshSuperMode) window.chessHelperEngine.refreshSuperMode();
        } else if (window.chessHelperEngine?.triggerAutoPlay) window.chessHelperEngine.triggerAutoPlay();
        if (window.chessHelperEngine?.refreshSoftMistakesCard) window.chessHelperEngine.refreshSoftMistakesCard();
    }, { signal });

    document.getElementById('ch-toggle-autoplay').addEventListener('change', (e) => {
        if (window.chessHelperEngine?.setAutoPlay) window.chessHelperEngine.setAutoPlay(e.target.checked);
        else {
            window.chessHelper.autoPlay = e.target.checked;
            if (window.chessHelper.autoPlay && window.chessHelperEngine?.triggerAutoPlay) window.chessHelperEngine.triggerAutoPlay();
        }
    }, { signal });

    document.getElementById('ch-toggle-engine').addEventListener('change', (e) => {
        window.chessHelper.useEngine = e.target.checked;
        localStorage.setItem('ch_use_engine', String(e.target.checked));
        if (window.chessHelperEngine?.triggerAutoPlay) window.chessHelperEngine.triggerAutoPlay();
    }, { signal });

    const superModeToggle = document.getElementById('ch-supermode-toggle');
    const superModeControls = document.getElementById('ch-supermode-controls');
    const superSettingsOverlay = document.getElementById('ch-super-settings-overlay');
    const closeSuperSettings = () => superSettingsOverlay.classList.remove('visible');
    superModeToggle.addEventListener('change', (e) => {
        window.chessHelper.superModeEnabled = e.target.checked;
        localStorage.setItem('ch_supermode_enabled', String(e.target.checked));
        superModeControls.style.display = e.target.checked ? 'block' : 'none';
        if (!e.target.checked) window.clearArrow('softMistake');
        if (window.chessHelperEngine?.refreshSuperMode) window.chessHelperEngine.refreshSuperMode();
        if (window.chessHelperEngine?.refreshSoftMistakesCard) window.chessHelperEngine.refreshSoftMistakesCard();
    }, { signal });

    document.getElementById('ch-supermode-settings').addEventListener('click', () => superSettingsOverlay.classList.add('visible'), { signal });
    document.getElementById('ch-super-settings-close').addEventListener('click', closeSuperSettings, { signal });
    superSettingsOverlay.addEventListener('click', (e) => { if (e.target === superSettingsOverlay) closeSuperSettings(); }, { signal });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeSuperSettings(); closeEngineSettings(); } }, { signal });

    const softMistakesSettingsOptions = document.getElementById('ch-soft-mistakes-settings-options');
    const softMistakesMinInput = document.getElementById('ch-soft-mistakes-min-drop');
    const softMistakesMaxInput = document.getElementById('ch-soft-mistakes-max-drop');
    const softMistakesCountSelect = document.getElementById('ch-soft-mistakes-count');
    const softMistakesSettingsNote = document.getElementById('ch-soft-mistakes-settings-note');
    const syncSoftMistakesSettingsAvailability = () => {
        if (softMistakesSettingsOptions) {
            softMistakesSettingsOptions.dataset.disabled = String(!window.chessHelper.superModeFeatures.softMistakes);
        }
    };
    const saveSoftMistakesConfig = () => {
        const minPawns = Number.parseFloat(softMistakesMinInput.value);
        const maxPawns = Number.parseFloat(softMistakesMaxInput.value);
        const minDropCp = Math.round(minPawns * 100);
        const maxDropCp = Math.round(maxPawns * 100);
        if (!Number.isFinite(minPawns) || !Number.isFinite(maxPawns) || minDropCp < 10 || minDropCp > 300 || maxDropCp < 20 || maxDropCp > 400 || minDropCp > maxDropCp) {
            softMistakesSettingsNote.textContent = minDropCp > maxDropCp
                ? 'Min drop must be <= Max drop.'
                : 'Enter drops from 0.10 to 3.00 (min) and 0.20 to 4.00 (max) pawns.';
            softMistakesSettingsNote.classList.add('is-error');
            return false;
        }
        const maxResults = Math.max(1, Math.min(4, Number.parseInt(softMistakesCountSelect.value, 10) || 3));
        softMistakesCountSelect.value = String(maxResults);
        window.chessHelper.softMistakes = { minDropCp, maxDropCp, maxResults };
        localStorage.setItem('ch_soft_mistakes_min_cp', String(minDropCp));
        localStorage.setItem('ch_soft_mistakes_max_cp', String(maxDropCp));
        localStorage.setItem('ch_soft_mistakes_count', String(maxResults));
        softMistakesSettingsNote.textContent = `Finds up to ${maxResults} move(s) dropping ${(minDropCp / 100).toFixed(2)}–${(maxDropCp / 100).toFixed(2)} pawns when you click Find.`;
        softMistakesSettingsNote.classList.remove('is-error');
        if (window.chessHelperEngine?.refreshSoftMistakesCard) window.chessHelperEngine.refreshSoftMistakesCard();
        return true;
    };
    softMistakesMinInput.addEventListener('change', saveSoftMistakesConfig, { signal });
    softMistakesMaxInput.addEventListener('change', saveSoftMistakesConfig, { signal });
    softMistakesCountSelect.addEventListener('change', saveSoftMistakesConfig, { signal });

    superSettingsOverlay.querySelectorAll('[data-super-feature]').forEach(input => {
        input.addEventListener('change', (e) => {
            const key = e.target.dataset.superFeature;
            if (!key || !Object.prototype.hasOwnProperty.call(window.chessHelper.superModeFeatures, key)) return;
            window.chessHelper.superModeFeatures[key] = e.target.checked;
            localStorage.setItem(`ch_super_${key}`, String(e.target.checked));
            if (key === 'softMistakes') {
                syncSoftMistakesSettingsAvailability();
                if (!e.target.checked) window.clearArrow('softMistake');
                if (window.chessHelperEngine?.refreshSoftMistakesCard) window.chessHelperEngine.refreshSoftMistakesCard();
            }
            if (window.chessHelperEngine?.refreshSuperMode) window.chessHelperEngine.refreshSuperMode();
        }, { signal });
    });

    const pvPliesSelect = document.getElementById('ch-super-pv-plies');
    const hudCornerSelect = document.getElementById('ch-super-hud-corner');
    const hudCompactCheckbox = document.getElementById('ch-super-hud-compact');
    pvPliesSelect.addEventListener('change', (e) => {
        const val = Math.max(2, Math.min(5, Number.parseInt(e.target.value, 10) || 3));
        e.target.value = String(val);
        window.chessHelper.superModeOptions.pvPlies = val;
        localStorage.setItem('ch_super_pv_plies', String(val));
        if (window.chessHelperEngine?.refreshSuperMode) window.chessHelperEngine.refreshSuperMode();
    }, { signal });
    hudCornerSelect.addEventListener('change', (e) => {
        const corner = e.target.value === 'bottom-left' ? 'bottom-left' : 'top-left';
        e.target.value = corner;
        window.chessHelper.superModeOptions.hudCorner = corner;
        localStorage.setItem('ch_super_hud_corner', corner);
        if (window.chessHelperEngine?.refreshSuperMode) window.chessHelperEngine.refreshSuperMode();
    }, { signal });
    hudCompactCheckbox.addEventListener('change', (e) => {
        const compact = Boolean(e.target.checked);
        window.chessHelper.superModeOptions.hudCompact = compact;
        localStorage.setItem('ch_super_hud_compact', String(compact));
        if (window.chessHelperEngine?.refreshSuperMode) window.chessHelperEngine.refreshSuperMode();
    }, { signal });

    document.getElementById('ch-supermode-review').addEventListener('click', () => {
        if (window.chessHelperEngine?.reviewSuperModeSession) window.chessHelperEngine.reviewSuperModeSession();
        closeSuperSettings();
    }, { signal });

    document.getElementById('ch-supermode-clear').addEventListener('click', () => {
        for (const feature of SUPER_MODE_FEATURES) {
            window.chessHelper.superModeFeatures[feature.key] = false;
            localStorage.setItem(`ch_super_${feature.key}`, 'false');
        }
        superSettingsOverlay.querySelectorAll('[data-super-feature]').forEach(input => {
            input.checked = false;
        });
        syncSoftMistakesSettingsAvailability();
        window.clearArrow('softMistake');
        if (window.chessHelperEngine?.refreshSoftMistakesCard) window.chessHelperEngine.refreshSoftMistakesCard();
        if (window.chessHelperEngine?.refreshSuperMode) window.chessHelperEngine.refreshSuperMode();
    }, { signal });

    // Arrow depth + visibility controls
    for (const key of ['d5', 'd10', 'd15']) {
        const lsDepthKey = `ch_depth_${key}`;
        const lsShowKey  = `ch_show_${key}`;

        document.getElementById(`ch-depth-${key}`).addEventListener('change', (e) => {
            const val = Math.max(1, Math.min(20, parseInt(e.target.value) || 1));
            e.target.value = val;
            window.chessHelper.arrows[key].depth = val;
            localStorage.setItem(lsDepthKey, val);
            if (window.chessHelperEngine?.triggerAutoPlay) window.chessHelperEngine.triggerAutoPlay();
        }, { signal });

        document.getElementById(`ch-show-${key}`).addEventListener('change', (e) => {
            window.chessHelper.arrows[key].show = e.target.checked;
            localStorage.setItem(lsShowKey, String(e.target.checked));
            if (!e.target.checked) window.clearArrow(key);
            else if (window.chessHelperEngine?.triggerAutoPlay) window.chessHelperEngine.triggerAutoPlay();
        }, { signal });
    }

    document.getElementById('ch-autoplay-arrow').addEventListener('change', (e) => {
        const value = ['d15', 'd10', 'd5', 'random-blue-teal'].includes(e.target.value) ? e.target.value : 'd15';
        window.chessHelper.autoplayArrow = value;
        e.target.value = value;
        localStorage.setItem('ch_autoplay_arrow', value);
        if (window.chessHelperEngine?.triggerAutoPlay) window.chessHelperEngine.triggerAutoPlay();
    }, { signal });

    document.getElementById('ch-human-info').addEventListener('click', (e) => {
        e.preventDefault();
        window.showCustomModal("Human Style 👑", "Plays exactly like a human grandmaster. It makes moves that look natural to avoid detection, without compromising your win chance.");
    }, { signal });

    document.getElementById('ch-human-toggle').addEventListener('click', (e) => {
        const isPremium = localStorage.getItem('ch_is_premium') === 'true';
        if (!isPremium) { e.preventDefault(); window.showCustomModal("Premium Feature", "Human Style is reserved for Premium users. Get your key to unlock stealth mode."); }
    }, { signal });

    const expandSection = document.getElementById('ch-expandable-section');
    document.getElementById('ch-btn-get-moves').addEventListener('click', () => { expandSection.classList.add('open'); updatePanelPosition(); }, { signal });
    document.getElementById('ch-btn-shrink').addEventListener('click', () => { expandSection.classList.remove('open'); updatePanelPosition(); }, { signal });

    document.getElementById('ch-active-key-info').addEventListener('click', (e) => {
        e.preventDefault();
        window.showCustomModal("Key Info", "This temporary key is for moves 60 and depth 7. You can get temporary keys or buy Premium keys from our website.");
    }, { signal });

    document.getElementById('ch-active-key-remove').addEventListener('click', (e) => {
        e.preventDefault();
        const activeKey = localStorage.getItem('ch_active_key');
        const currentBonus = parseInt(localStorage.getItem('ch_bonus_moves') || '0');
        const isPremium = localStorage.getItem('ch_is_premium') === 'true';
        let savedKeys = JSON.parse(localStorage.getItem('ch_saved_keys') || '{}');
        if (activeKey) {
            if (isPremium) savedKeys[activeKey] = 'UNLIMITED';
            else if (currentBonus > 0) savedKeys[activeKey] = currentBonus;
            localStorage.setItem('ch_saved_keys', JSON.stringify(savedKeys));
        }
        localStorage.removeItem('ch_active_key');
        localStorage.removeItem('ch_is_premium');
        localStorage.setItem('ch_bonus_moves', '0');
        if (window.chessHelperEngine?.updateMoveUI) window.chessHelperEngine.updateMoveUI();
    }, { signal });

    document.getElementById('ch-btn-get-key').addEventListener('click', () => window.open('https://xndroid.store/ads-page-placeholder', '_blank'), { signal });
    document.getElementById('ch-btn-buy-premium').addEventListener('click', () => window.open('https://xndroid.store/premium-placeholder', '_blank'), { signal });

    document.getElementById('ch-btn-submit-key').addEventListener('click', async () => {
        const input = document.getElementById('ch-key-input').value.trim().toUpperCase();
        if (!input) return;
        const currentBonus = parseInt(localStorage.getItem('ch_bonus_moves') || '0');
        const activeKey = localStorage.getItem('ch_active_key');
        const isPremium = localStorage.getItem('ch_is_premium') === 'true';
        let savedKeys = JSON.parse(localStorage.getItem('ch_saved_keys') || '{}');
        if (input === activeKey) { window.showCustomModal("Key Active", `Key ${input} is already active.`); return; }
        const btnSubmit = document.getElementById('ch-btn-submit-key');
        const originalContent = btnSubmit.innerHTML;
        btnSubmit.innerHTML = `<span style="font-size: 10px;">...</span>`;
        btnSubmit.disabled = true;
        try {
            const res = await fetch('https://xndroid.store/api/verify-key', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: input }) });
            const data = await res.json();
            if (!data.valid) { window.showCustomModal("Invalid Key", data.error || "The key you entered is not valid or has expired."); btnSubmit.innerHTML = originalContent; btnSubmit.disabled = false; return; }
            if (activeKey) {
                if (isPremium) { savedKeys[activeKey] = 'UNLIMITED'; localStorage.removeItem('ch_is_premium'); }
                else if (currentBonus > 0) savedKeys[activeKey] = currentBonus;
            }
            let activatingPremium = data.isPremium || false;
            let newBonus = data.moves_remain || 0;
            if (activatingPremium) {
                localStorage.setItem('ch_is_premium', 'true');
                window.showCustomModal("Premium Activated 💎", `Key ${input} is active. You have unlimited moves and max depth.`);
            } else {
                window.showCustomModal("Success!", `${newBonus} Moves have been loaded from your key.`);
            }
            if (savedKeys[input]) delete savedKeys[input];
            localStorage.setItem('ch_saved_keys', JSON.stringify(savedKeys));
            localStorage.setItem('ch_active_key', input);
            if (!activatingPremium) localStorage.setItem('ch_bonus_moves', newBonus.toString());
            if (window.chessHelperEngine?.updateMoveUI) window.chessHelperEngine.updateMoveUI();
            document.getElementById('ch-key-input').value = "";
        } catch (error) {
            window.showCustomModal("Network Error", "Could not connect to the verification server.");
        }
        btnSubmit.innerHTML = originalContent;
        btnSubmit.disabled = false;
    }, { signal });
}

// --- VISUALIZATION ---
const ARROW_CONFIG = {
    d15:         { stroke: '#4ade80', hlStart: 'rgba(74,222,128,0.35)', hlEnd: 'rgba(74,222,128,0.55)', speed: 1.0   },
    d10:         { stroke: '#2dd4bf', hlStart: 'rgba(45,212,191,0.35)', hlEnd: 'rgba(45,212,191,0.55)', speed: 1.3   },
    d5:          { stroke: '#38bdf8', hlStart: 'rgba(56,189,248,0.35)', hlEnd: 'rgba(56,189,248,0.55)', speed: 0.75  },
    database:    { stroke: '#5aa4ff', hlStart: 'rgba(67,126,255,0.35)', hlEnd: 'rgba(90,164,255,0.55)', speed: 0.9   },
    softMistake: { stroke: '#f59e0b', hlStart: 'rgba(245,158,11,0.28)', hlEnd: 'rgba(245,158,11,0.48)', speed: 1.15  },
};

const _colToNum = { 'a': 1, 'b': 2, 'c': 3, 'd': 4, 'e': 5, 'f': 6, 'g': 7, 'h': 8 };

function _getBoard() { return document.querySelector('wc-chess-board') || document.querySelector('.board') || document.querySelector('chess-board'); }

window.clearArrow = function (key) {
    document.querySelectorAll(`.ch-arrow-svg-${key}, .ch-highlight-${key}`).forEach(el => el.remove());
};

window.clearAllArrows = function () {
    document.querySelectorAll('.ch-arrow-svg, .ch-highlight').forEach(el => el.remove());
};

window.drawArrow = function (key, move) {
    window.clearArrow(key);
    const board = _getBoard();
    if (!board || !move) return;

    const cfg = ARROW_CONFIG[key] || ARROW_CONFIG.d15;
    const startSq = move.substring(0, 2);
    const endSq = move.substring(2, 4);
    const sqClass = (sq) => `square-${_colToNum[sq[0]]}${sq[1]}`;
    const isFlipped = board.classList.contains('flipped');

    // Highlight squares
    const mkHL = (sq, color) => {
        const div = document.createElement('div');
        div.className = `ch-highlight ch-highlight-${key} ${sqClass(sq)}`;
        div.style.backgroundColor = color;
        board.appendChild(div);
    };
    mkHL(startSq, cfg.hlStart);
    mkHL(endSq, cfg.hlEnd);

    // SVG arrow
    const getCenter = (sq) => {
        const col = _colToNum[sq[0]];
        const row = parseInt(sq[1]);
        if (!col || isNaN(row)) return null;
        const size = 12.5, half = 6.25;
        let x, y;
        if (!isFlipped) { x = (col - 1) * size + half; y = (8 - row) * size + half; }
        else { x = (8 - col) * size + half; y = (row - 1) * size + half; }
        return { x, y };
    };

    const s = getCenter(startSq);
    const e = getCenter(endSq);
    if (!s || !e) return;

    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 100 100");
    svg.classList.add('ch-arrow-svg', `ch-arrow-svg-${key}`);

    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", s.x); line.setAttribute("y1", s.y);
    line.setAttribute("x2", e.x); line.setAttribute("y2", e.y);
    line.classList.add('ch-arrow-line');
    line.setAttribute('stroke', cfg.stroke);
    line.style.animation = `dash ${cfg.speed}s linear infinite`;

    const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    circle.setAttribute("cx", e.x); circle.setAttribute("cy", e.y);
    circle.setAttribute("r", "2.2");
    circle.setAttribute("fill", cfg.stroke);

    svg.appendChild(line);
    svg.appendChild(circle);
    board.appendChild(svg);
};

// Backward compat shims
window.drawDottedMove = function (move, source = 'engine') {
    const key = source === 'database' ? 'database' : 'd15';
    window.drawArrow(key, move);
};
window.clearDottedMove = function () { window.clearAllArrows(); };

if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', initUI); } else { initUI(); }
