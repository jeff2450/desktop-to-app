/**
 * WebToApp — Update Banner
 *
 * Injected into every converted app via webContents.executeJavaScript().
 * Shows a non-blocking, dismissible banner when a new version is available
 * or has been downloaded. Uses CSS custom properties so it adapts to both
 * light and dark app backgrounds.
 *
 * Does NOT modify the app's DOM structure — the banner sits in a fixed overlay.
 * Buttons wire directly to window.electronAPI (exposed by preload.cjs).
 */
(function webToAppUpdateBanner() {
  'use strict';

  // Guard against double-injection
  if (document.getElementById('__wta-banner')) return;
  if (!window.electronAPI) return;

  // ── Styles ────────────────────────────────────────────────────────────────
  const style = document.createElement('style');
  style.textContent = `
    #__wta-banner {
      position: fixed;
      bottom: 20px;
      right: 20px;
      z-index: 2147483647;
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px 16px;
      border-radius: 12px;
      background: rgba(15, 17, 23, 0.92);
      backdrop-filter: blur(20px) saturate(1.4);
      -webkit-backdrop-filter: blur(20px) saturate(1.4);
      border: 1px solid rgba(255,255,255,0.1);
      box-shadow: 0 8px 32px rgba(0,0,0,0.4), 0 2px 8px rgba(0,0,0,0.2);
      color: rgba(255,255,255,0.92);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
      font-size: 13px;
      line-height: 1;
      max-width: 340px;
      transform: translateY(80px);
      opacity: 0;
      transition: transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1),
                  opacity 0.25s ease;
      pointer-events: all;
      -webkit-app-region: no-drag;
      user-select: none;
    }

    #__wta-banner.visible {
      transform: translateY(0);
      opacity: 1;
    }

    #__wta-banner .wta-icon {
      width: 28px;
      height: 28px;
      border-radius: 8px;
      background: rgba(79, 142, 247, 0.2);
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }

    #__wta-banner .wta-icon svg {
      width: 14px;
      height: 14px;
    }

    #__wta-banner .wta-text {
      flex: 1;
      min-width: 0;
    }

    #__wta-banner .wta-title {
      font-weight: 600;
      font-size: 13px;
      color: rgba(255,255,255,0.95);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    #__wta-banner .wta-sub {
      font-size: 11px;
      color: rgba(255,255,255,0.5);
      margin-top: 3px;
    }

    #__wta-banner .wta-actions {
      display: flex;
      gap: 6px;
      flex-shrink: 0;
    }

    #__wta-banner button {
      padding: 6px 12px;
      border-radius: 7px;
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      border: none;
      outline: none;
      transition: opacity 0.15s;
      font-family: inherit;
    }

    #__wta-banner button:hover { opacity: 0.8; }
    #__wta-banner button:active { transform: scale(0.96); }

    #__wta-banner .wta-btn-primary {
      background: #4f8ef7;
      color: #fff;
    }

    #__wta-banner .wta-btn-dismiss {
      background: rgba(255,255,255,0.08);
      color: rgba(255,255,255,0.6);
    }

    /* Spinning loader for "downloading" state */
    @keyframes __wta-spin {
      to { transform: rotate(360deg); }
    }
    .wta-spin { animation: __wta-spin 1s linear infinite; }
  `;
  document.head.appendChild(style);

  // ── DOM ───────────────────────────────────────────────────────────────────
  const banner = document.createElement('div');
  banner.id = '__wta-banner';
  banner.setAttribute('role', 'status');
  banner.setAttribute('aria-live', 'polite');
  banner.innerHTML = `
    <div class="wta-icon">
      <svg id="__wta-icon-svg" viewBox="0 0 24 24" fill="none" stroke="#4f8ef7" stroke-width="2"
           stroke-linecap="round" stroke-linejoin="round">
        <polyline points="23 4 23 10 17 10"/>
        <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
      </svg>
    </div>
    <div class="wta-text">
      <div class="wta-title" id="__wta-title">Update available</div>
      <div class="wta-sub"  id="__wta-sub">A new version is ready to install.</div>
    </div>
    <div class="wta-actions">
      <button class="wta-btn-primary"  id="__wta-btn-action">Install</button>
      <button class="wta-btn-dismiss" id="__wta-btn-dismiss">✕</button>
    </div>
  `;
  document.body.appendChild(banner);

  // ── State ─────────────────────────────────────────────────────────────────
  let updateReady = false;

  function show(title, sub) {
    document.getElementById('__wta-title').textContent = title;
    document.getElementById('__wta-sub').textContent   = sub;
    requestAnimationFrame(() => banner.classList.add('visible'));
  }

  function hide() {
    banner.classList.remove('visible');
  }

  // ── Events ────────────────────────────────────────────────────────────────
  document.getElementById('__wta-btn-dismiss').addEventListener('click', hide);

  document.getElementById('__wta-btn-action').addEventListener('click', () => {
    if (updateReady) {
      // Downloaded — quit and install
      window.electronAPI.installUpdate();
    } else {
      // Still downloading — show spinner
      const btn = document.getElementById('__wta-btn-action');
      btn.disabled = true;
      btn.textContent = '…';
      const svg = document.getElementById('__wta-icon-svg');
      svg.classList.add('wta-spin');
    }
  });

  // ── IPC listeners ─────────────────────────────────────────────────────────
  if (typeof window.electronAPI.onUpdateAvailable === 'function') {
    window.electronAPI.onUpdateAvailable((info) => {
      updateReady = false;
      const version = info?.version ?? 'a new version';
      show(`Update available — v${version}`, 'Downloading in the background…');
      document.getElementById('__wta-btn-action').textContent = 'Downloading…';
      document.getElementById('__wta-btn-action').disabled = true;
    });
  }

  if (typeof window.electronAPI.onUpdateDownloaded === 'function') {
    window.electronAPI.onUpdateDownloaded((info) => {
      updateReady = true;
      const version = info?.version ?? 'new version';
      document.getElementById('__wta-btn-action').disabled = false;
      document.getElementById('__wta-icon-svg').classList.remove('wta-spin');
      show(`v${version} ready to install`, 'Restart to apply the update.');
      document.getElementById('__wta-btn-action').textContent = 'Restart & Install';
    });
  }
})();
