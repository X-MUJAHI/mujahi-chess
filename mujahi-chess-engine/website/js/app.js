/**
 * Shared site UI behavior for MUJAHI static website (mobile menu, copy buttons,
 * endpoint override helper, and live header/home health check).
 */
(function initSiteUi() {
  'use strict';

  function initMobileMenu() {
    const toggleBtn = document.getElementById('mobile-menu-toggle');
    const mobileNav = document.getElementById('mobile-nav');
    if (!toggleBtn || !mobileNav) return;

    toggleBtn.addEventListener('click', () => {
      const open = mobileNav.classList.toggle('open');
      toggleBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  }

  function initCopyButtons() {
    document.querySelectorAll('[data-copy-target]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const targetId = btn.getAttribute('data-copy-target');
        const target = targetId ? document.getElementById(targetId) : null;
        if (!target) return;
        const text = target.textContent || '';
        try {
          await navigator.clipboard.writeText(text);
          const original = btn.textContent;
          btn.textContent = 'Copied';
          setTimeout(() => {
            btn.textContent = original;
          }, 1500);
        } catch {
          btn.textContent = 'Copy manually';
        }
      });
    });
  }

  function initEndpointBanner() {
    const endpointEls = document.querySelectorAll('[data-api-base-url]');
    const current = window.MujahiApiClient?.getApiBaseUrl() || 'Not configured';
    endpointEls.forEach((el) => {
      el.textContent = current;
    });

    const form = document.getElementById('api-override-form');
    const input = document.getElementById('api-override-input');
    const resetBtn = document.getElementById('api-override-reset');
    if (!form || !input || !window.MujahiApiClient) return;

    input.value = window.MujahiApiClient.getApiBaseUrl();

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const updated = window.MujahiApiClient.setApiBaseUrlOverride(input.value);
      endpointEls.forEach((el) => {
        el.textContent = updated || 'Not configured';
      });
      window.dispatchEvent(new CustomEvent('mujahi:endpoint-changed', { detail: { url: updated } }));
    });

    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        const updated = window.MujahiApiClient.setApiBaseUrlOverride('');
        input.value = updated;
        endpointEls.forEach((el) => {
          el.textContent = updated || 'Not configured';
        });
        window.dispatchEvent(new CustomEvent('mujahi:endpoint-changed', { detail: { url: updated } }));
      });
    }
  }

  async function initHomeLiveSummary() {
    const card = document.getElementById('home-live-summary');
    if (!card || !window.MujahiApiClient) return;

    const statusEl = document.getElementById('home-status-value');
    const versionEl = document.getElementById('home-version-value');
    const netEl = document.getElementById('home-net-value');
    const queueEl = document.getElementById('home-queue-value');
    const latencyEl = document.getElementById('home-latency-value');

    async function load() {
      if (statusEl) {
        statusEl.textContent = 'Checking...';
        statusEl.className = 'spec-value status-label';
      }
      try {
        const { payload, latencyMs } = await window.MujahiApiClient.getHealth();
        if (statusEl) {
          statusEl.textContent = payload.engine?.ready ? 'ONLINE (READY)' : String(payload.status || 'INITIALIZING').toUpperCase();
          statusEl.className = payload.engine?.ready ? 'spec-value status-label status-ok' : 'spec-value status-label status-warn';
        }
        if (versionEl) versionEl.textContent = payload.engine?.version || 'Stockfish 19 (sf_19)';
        if (netEl) netEl.textContent = payload.engine?.defaultNet || 'nn-1a298aa575a0.nnue';
        if (queueEl) queueEl.textContent = `${payload.queue?.queuedJobs ?? 0} queued / ${payload.queue?.maxQueue ?? 0} max`;
        if (latencyEl) latencyEl.textContent = `${latencyMs} ms`;
      } catch (err) {
        if (statusEl) {
          statusEl.textContent = 'OFFLINE / SLEEPING';
          statusEl.className = 'spec-value status-label status-error';
        }
        if (latencyEl) latencyEl.textContent = err.message || 'Unreachable';
      }
    }

    load();
    window.addEventListener('mujahi:endpoint-changed', load);
  }

  function initExtensionPage() {
    const container = document.getElementById('extension-download-area');
    if (!container) return;

    const url = (window.MUJAHI_CONFIG?.EXTENSION_DOWNLOAD_URL || '').trim();
    const versionEl = document.getElementById('extension-target-version');
    if (versionEl) {
      versionEl.textContent = window.MUJAHI_CONFIG?.EXTENSION_VERSION || '2.1.0';
    }

    if (url) {
      container.innerHTML = `<a class="btn btn-primary" href="${url.replace(/"/g, '&quot;')}" rel="noopener noreferrer">Download Chess Helper Package</a>`;
    } else {
      container.innerHTML = `<div class="notice"><strong>Extension package URL not configured yet.</strong> Set <code>EXTENSION_DOWNLOAD_URL</code> in <code>website/config.js</code> once you publish the extension release zip, or load your local Chess Helper 2.1.0 folder with the adapter in <code>examples/</code>.</div>`;
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    initMobileMenu();
    initCopyButtons();
    initEndpointBanner();
    initHomeLiveSummary();
    initExtensionPage();
  });
})();
