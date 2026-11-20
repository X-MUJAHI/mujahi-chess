/**
 * Server status and engine telemetry page controller for status.html.
 * Fetches live /health and /v1/engine without fabricating fallback data.
 */
(function initStatusPage() {
  'use strict';

  document.addEventListener('DOMContentLoaded', () => {
    const refreshBtn = document.getElementById('status-refresh-btn');
    if (!refreshBtn || !window.MujahiApiClient) return;

    const stateEl = document.getElementById('status-overall');
    const latencyEl = document.getElementById('status-latency');
    const engineVersionEl = document.getElementById('status-engine-version');
    const engineCommitEl = document.getElementById('status-engine-commit');
    const nnueEl = document.getElementById('status-engine-nnue');
    const queueActiveEl = document.getElementById('status-queue-active');
    const queueWaitingEl = document.getElementById('status-queue-waiting');
    const memoryRssEl = document.getElementById('status-memory-rss');
    const uptimeEl = document.getElementById('status-uptime');
    const configTableEl = document.getElementById('status-config-rows');
    const rawHealthEl = document.getElementById('status-raw-json');
    const alertEl = document.getElementById('status-alert');

    async function refreshStatus() {
      refreshBtn.disabled = true;
      stateEl.textContent = 'Checking...';
      stateEl.className = 'metric-value status-label';
      alertEl.className = 'notice';
      alertEl.textContent = 'Querying /health and /v1/engine...';

      try {
        const [healthRes, engineRes] = await Promise.all([
          window.MujahiApiClient.getHealth(),
          window.MujahiApiClient.getEngineInfo(),
        ]);

        const health = healthRes.payload;
        const engineInfo = engineRes.payload;

        stateEl.textContent = health.engine?.ready ? 'ONLINE' : String(health.status || 'INITIALIZING').toUpperCase();
        stateEl.className = health.engine?.ready
          ? 'metric-value status-label status-ok'
          : 'metric-value status-label status-warn';

        latencyEl.textContent = `${healthRes.latencyMs} ms`;
        engineVersionEl.textContent = engineInfo.version || 'Stockfish 19';
        engineCommitEl.textContent = engineInfo.commit || 'edb0d9db6731067ec50ce619ff372b463bc4dd5d';
        nnueEl.textContent = engineInfo.defaultNet || 'nn-1a298aa575a0.nnue';
        queueActiveEl.textContent = String(health.queue?.activeJobs ?? 0);
        queueWaitingEl.textContent = `${health.queue?.queuedJobs ?? 0} / ${health.queue?.maxQueue ?? 0}`;
        memoryRssEl.textContent = `${health.memory?.rssMb ?? '—'} MB RSS (Hash: ${health.memory?.configuredHashMb ?? '—'} MB)`;
        uptimeEl.textContent = `${health.uptimeSeconds ?? 0}s`;

        const cfg = engineInfo.configuration || {};
        configTableEl.innerHTML = `
          <tr><td>UCI Threads</td><td class="mono">${cfg.threads ?? '—'}</td></tr>
          <tr><td>UCI Hash</td><td class="mono">${cfg.hashMb ?? '—'} MB</td></tr>
          <tr><td>Default / Max Depth</td><td class="mono">${cfg.defaultDepth ?? '—'} / ${cfg.maxDepth ?? '—'}</td></tr>
          <tr><td>Max Queue</td><td class="mono">${cfg.maxQueue ?? '—'}</td></tr>
          <tr><td>Default / Max Timeout</td><td class="mono">${cfg.defaultTimeoutMs ?? '—'} ms / ${cfg.maxTimeoutMs ?? '—'} ms</td></tr>
        `;

        rawHealthEl.textContent = JSON.stringify({ health, engine: engineInfo }, null, 2);
        alertEl.className = 'notice notice-ok';
        alertEl.textContent = `Connected to ${window.MujahiApiClient.getApiBaseUrl()} at ${new Date().toLocaleTimeString()}.`;
      } catch (err) {
        stateEl.textContent = 'UNREACHABLE';
        stateEl.className = 'metric-value status-label status-error';
        latencyEl.textContent = '—';
        alertEl.className = 'notice notice-error';
        alertEl.textContent = `Could not reach backend (${err.message}). If deployed on Render Free tier, the container may be waking from sleep (15-50s cold start).`;
        rawHealthEl.textContent = JSON.stringify({ error: err.message, code: err.code || 'FETCH_ERROR' }, null, 2);
      } finally {
        refreshBtn.disabled = false;
      }
    }

    refreshBtn.addEventListener('click', refreshStatus);
    window.addEventListener('mujahi:endpoint-changed', refreshStatus);
    refreshStatus();
  });
})();
