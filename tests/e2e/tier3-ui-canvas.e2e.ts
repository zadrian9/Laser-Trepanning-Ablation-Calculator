import fs from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CdpSession, withCdpPage } from './helpers/cdp.ts';
import {
  cloneDefaultInput,
  closeViteSsrServer,
  loadPresetsContract,
  loadSchemaContract,
  loadTsEngineContract,
} from './helpers/contracts.ts';
import {
  assertDeliverableExists,
  type DistSubpathServer,
  expectClose,
  resolveWorkspacePath,
  startDistSubpathServer,
  walkFiles,
} from './helpers/env.ts';

let distServer: DistSubpathServer | null = null;

async function ensureDistServer(): Promise<DistSubpathServer> {
  if (!distServer) {
    distServer = await startDistSubpathServer('/LaserTrepanningCalculator/');
  }
  return distServer;
}

afterAll(async () => {
  if (distServer) {
    await distServer.close();
    distServer = null;
  }
  await closeViteSsrServer();
});

async function assertM4UiReady(page: CdpSession): Promise<void> {
  const probe = await page.evaluate<{
    tabCount: number;
    hasColorSchemeMeta: boolean;
    hasDialog: boolean;
    hasIsofluenceCanvas: boolean;
    hasStyleLink404: boolean;
  }>(`(() => {
    const tabs = document.querySelectorAll('[role="tab"], .tab-btn');
    const meta = document.querySelector('meta[name="color-scheme"]');
    const dialog = document.querySelector('dialog');
    const canvases = Array.from(document.querySelectorAll('canvas'));
    return {
      tabCount: tabs.length,
      hasColorSchemeMeta: Boolean(meta && /light\\s+dark|dark\\s+light/i.test(meta.getAttribute('content') || '')),
      hasDialog: Boolean(dialog),
      hasIsofluenceCanvas: canvases.length >= 4,
      hasStyleLink404: false,
    };
  })()`);

  if (page.failedRequests.some((r) => r.url.endsWith('style.css') && r.status === 404)) {
    throw new Error('Waiting for M4: dist/index.html references missing style.css (404)');
  }
  if (!probe.hasIsofluenceCanvas || probe.tabCount < 4) {
    throw new Error(
      `Waiting for M3/M4: expected 4 canvas tabs in dist/index.html, found ${probe.tabCount} tabs and ${probe.hasIsofluenceCanvas ? '>=4' : '<4'} canvases`,
    );
  }
  if (!probe.hasColorSchemeMeta || !probe.hasDialog) {
    throw new Error(
      'Waiting for M4: missing <meta name="color-scheme"> or native <dialog> in dist/index.html',
    );
  }
}

const UI_HELPERS_SCRIPT = `(() => {
  if (window.__e2eUi) return true;
  window.__e2eUi = {
    isVisible(el) {
      if (!el) return false;
      if (el.hidden || el.closest('[hidden]')) return false;
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
      return el.offsetParent !== null || el.getClientRects().length > 0;
    },
    getTabs() {
      return Array.from(document.querySelectorAll('[role="tab"], .tab-btn'));
    },
    selectTab(keyword) {
      const rx = new RegExp(keyword, 'i');
      const tab = this.getTabs().find((t) =>
        rx.test(t.getAttribute('data-tab') || '') || rx.test(t.textContent || '')
      );
      if (!tab) throw new Error('Tab not found: ' + keyword);
      tab.click();
      return true;
    },
    getVisibleCanvas() {
      const canvases = Array.from(document.querySelectorAll('canvas'));
      return canvases.find((c) => c.offsetWidth > 0 && c.offsetHeight > 0) || null;
    },
    getActiveTable() {
      const panelTables = Array.from(
        document.querySelectorAll('[role="tabpanel"]:not([hidden]) table, .canvas-tab-panel.active table'),
      );
      const visiblePanelTable = panelTables.find((t) => this.isVisible(t));
      if (visiblePanelTable) return visiblePanelTable;
      return Array.from(document.querySelectorAll('table')).find((t) => this.isVisible(t)) || null;
    },
    expandDetailsFor(selector) {
      const target = document.querySelector(selector);
      if (!target) return false;
      let cur = target.closest('details');
      while (cur) {
        if (!cur.open) {
          const sum = cur.querySelector(':scope > summary');
          if (sum) sum.click();
          else cur.open = true;
        }
        cur = cur.parentElement ? cur.parentElement.closest('details') : null;
      }
      return true;
    },
    selectOptionByText(selectSelector, textMatch) {
      const sel = document.querySelector(selectSelector);
      if (!sel) return false;
      const rx = new RegExp(textMatch, 'i');
      const opt = Array.from(sel.options).find((o) => rx.test(o.text) || rx.test(o.value));
      if (!opt) return false;
      sel.value = opt.value;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    },
    getZLookupReadout() {
      const explicit = Array.from(
        document.querySelectorAll(
          '[data-z-lookup-readout], #readoutAblatedAtZ, #readoutZFromFocus, #metricAblatedAtZ, [id*="Ablated" i][id*="Z" i], [id*="zFromFocus" i], [id*="zLookup" i], [class*="z-lookup" i]',
        ),
      ).find((el) => this.isVisible(el));
      if (explicit) return (explicit.textContent || '').trim();
      for (const lbl of document.querySelectorAll('label')) {
        if (/Z\\s*From\\s*Focus/i.test(lbl.textContent || '')) {
          const group = lbl.closest('.form-group, .control-group, .field, div');
          if (group) {
            const out = Array.from(group.querySelectorAll('output, strong, span, [data-readout]')).find(
              (el) => this.isVisible(el) && !el.contains(lbl),
            );
            if (out) return (out.textContent || '').trim();
          }
        }
      }
      return '';
    },
    getCanvasHash(canvas) {
      if (!canvas || canvas.width === 0 || canvas.height === 0) return null;
      const off = document.createElement('canvas');
      off.width = 64;
      off.height = 64;
      const ctx = off.getContext('2d');
      ctx.drawImage(canvas, 0, 0, 64, 64);
      const data = ctx.getImageData(0, 0, 64, 64).data;
      let hash = 2166136261;
      let minLuma = 255;
      let maxLuma = 0;
      const distinct = new Set();
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
        hash ^= r; hash = Math.imul(hash, 16777619);
        hash ^= g; hash = Math.imul(hash, 16777619);
        hash ^= b; hash = Math.imul(hash, 16777619);
        hash ^= a; hash = Math.imul(hash, 16777619);
        const luma = (r + g + b) / 3;
        if (luma < minLuma) minLuma = luma;
        if (luma > maxLuma) maxLuma = luma;
        if (distinct.size < 20) distinct.add((r >> 4) + ',' + (g >> 4) + ',' + (b >> 4));
      }
      return {
        width: canvas.width,
        height: canvas.height,
        clientWidth: canvas.clientWidth,
        clientHeight: canvas.clientHeight,
        hash: hash >>> 0,
        lumaSpread: maxLuma - minLuma,
        distinctColors: distinct.size,
      };
    },
    setInputValue(selectorOrLabel, value) {
      let el = document.querySelector(selectorOrLabel);
      if (!el) {
        const rx = new RegExp(selectorOrLabel, 'i');
        for (const lbl of document.querySelectorAll('label')) {
          if (rx.test(lbl.textContent || '')) {
            el = lbl.htmlFor ? document.getElementById(lbl.htmlFor) : lbl.querySelector('input,select');
            if (el) break;
          }
        }
      }
      if (!el) throw new Error('Input not found: ' + selectorOrLabel);
      if (el.type === 'checkbox' || el.type === 'radio') {
        el.checked = Boolean(value);
      } else {
        el.value = String(value);
      }
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    },
    clickControl(regexStr, rootSelector) {
      const rx = new RegExp(regexStr, 'i');
      const roots = rootSelector ? Array.from(document.querySelectorAll(rootSelector)) : [document];
      if (roots.length === 0) throw new Error('Root not found: ' + rootSelector);
      const seen = new Set();
      for (const root of roots) {
        const candidates = Array.from(
          root.querySelectorAll('button, label, input[type="checkbox"], input[type="radio"], summary'),
        );
        for (const el of candidates) {
          if (seen.has(el) || !this.isVisible(el)) continue;
          if (el.tagName === 'LABEL' && el.querySelector('select')) continue;
          seen.add(el);
          const text =
            (el.textContent || '') +
            ' ' +
            (el.getAttribute('aria-label') || '') +
            ' ' +
            (el.getAttribute('title') || '') +
            ' ' +
            (el.id ? el.id + ' #' + el.id : '');
          if (rx.test(text)) {
            el.click();
            return true;
          }
        }
      }
      return false;
    },
  };
  return true;
})()`;

async function waitRaf(page: CdpSession, frames = 2): Promise<void> {
  await page.evaluate(`new Promise((resolve) => {
    let left = ${frames};
    const tick = () => {
      if (--left <= 0) resolve(true);
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  })`);
}

async function bootApp(
  page: CdpSession,
  opts?: { clearStorage?: boolean; waitWorkerMs?: number },
): Promise<void> {
  const srv = await ensureDistServer();
  page.clearLogs();
  await page.navigate(srv.baseUrl);
  if (opts?.clearStorage) {
    await page.evaluate('localStorage.clear()');
    await page.reload();
  }
  await page.waitFor('document.readyState === "complete"');
  await assertM4UiReady(page);
  await page.evaluate(UI_HELPERS_SCRIPT);
  await page.waitFor(
    '(() => { const b = document.querySelector("#badgeEngineBackend")?.textContent || ""; const s = document.querySelector("#metricSpotSize")?.textContent || ""; return b.length > 0 && !/Initializing/i.test(b) && s.trim().length > 0 && s.trim() !== "--"; })()',
    10000,
    40,
  );
  await waitRaf(page, 2);
}

describe('Tier 2 — F2 Browser PWA Runtime & Offline SW', () => {
  it('T2-F2-02: Workbox Service Worker activates and serves app shell cleanly offline', async () => {
    const srv = await ensureDistServer();
    await withCdpPage(async (page) => {
      await bootApp(page);
      const swReady = await page.evaluate<boolean>(`(async () => {
        if (!('serviceWorker' in navigator)) return false;
        const reg = await Promise.race([
          navigator.serviceWorker.ready,
          new Promise((res) => setTimeout(() => res(null), 6000)),
        ]);
        return Boolean(reg && reg.active);
      })()`);
      expect(swReady, 'Service worker did not become active').toBe(true);

      const reqBefore = srv.requests.length;
      await page.setOffline(true);
      page.clearLogs();
      await page.reload();
      await page.waitFor('document.readyState === "complete"');
      await page.evaluate(UI_HELPERS_SCRIPT);

      const title = await page.evaluate<string>('document.title');
      expect(title.toLowerCase()).toContain('laser');
      expect(srv.requests.length - reqBefore).toBe(0);
      expect(page.consoleErrors).toEqual([]);
      expect(page.pageErrors).toEqual([]);
    });
  });

  it('T2-F2-04: PWA install button stays hidden when navigator.install and beforeinstallprompt are absent', async () => {
    await withCdpPage(async (page) => {
      await page.addScriptToEvaluateOnNewDocument(
        'try { delete Navigator.prototype.install; } catch { try { Object.defineProperty(Navigator.prototype, "install", { value: undefined, configurable: true }); } catch {} }',
      );
      await bootApp(page);
      const installState = await page.evaluate<{ exists: boolean; hidden: boolean }>(`(() => {
        const btn = document.querySelector('#btnInstallPwa, #btnInstall, [data-action="install"], button[id*="Install" i]');
        if (!btn) return { exists: false, hidden: true };
        const style = getComputedStyle(btn);
        return {
          exists: true,
          hidden: btn.hidden || style.display === 'none' || style.visibility === 'hidden',
        };
      })()`);

      expect(installState.exists, 'Missing PWA install button in M4 UI').toBe(true);
      expect(installState.hidden).toBe(true);
    });
  });

  it('T2-F2-05: PWA install button reveals on beforeinstallprompt, triggers prompt(), and hides on appinstalled', async () => {
    await withCdpPage(async (page) => {
      await bootApp(page);
      const lifecycle = await page.evaluate<{
        visibleAfterPrompt: boolean;
        promptCalled: boolean;
        hiddenAfterInstalled: boolean;
      }>(`(async () => {
        const btn = document.querySelector('#btnInstallPwa, #btnInstall, [data-action="install"], button[id*="Install" i]');
        if (!btn) throw new Error('Waiting for M4: install button missing');
        let promptCalled = false;
        const ev = new Event('beforeinstallprompt', { cancelable: true });
        ev.prompt = async () => {
          promptCalled = true;
          return { outcome: 'accepted' };
        };
        ev.userChoice = Promise.resolve({ outcome: 'accepted' });
        window.dispatchEvent(ev);
        const visibleAfterPrompt = !btn.hidden && getComputedStyle(btn).display !== 'none';
        btn.click();
        await new Promise((r) => setTimeout(r, 30));
        window.dispatchEvent(new Event('appinstalled'));
        const hiddenAfterInstalled = btn.hidden || getComputedStyle(btn).display === 'none';
        return { visibleAfterPrompt, promptCalled, hiddenAfterInstalled };
      })()`);

      expect(lifecycle.visibleAfterPrompt).toBe(true);
      expect(lifecycle.promptCalled).toBe(true);
      expect(lifecycle.hiddenAfterInstalled).toBe(true);
    });
  });
});

describe('Tier 1 & Tier 2 — F8–F11 Browser UI & Canvas Suite', () => {
  let page!: CdpSession;

  beforeAll(async () => {
    await ensureDistServer();
    page = await CdpSession.launch({ width: 1280, height: 860, deviceScaleFactor: 1 });
  });

  afterAll(async () => {
    await page.close();
  });

  it('T1-F8-01: ResizeObserver sizes canvas backing store to integer clientWidth * DPR at DPR=1 and DPR=2', async () => {
    await bootApp(page);
    const dpr1 = await page.evaluate<{
      dpr: number;
      w: number;
      h: number;
      cw: number;
      ch: number;
    }>(`(() => {
      const c = window.__e2eUi.getVisibleCanvas();
      return { dpr: window.devicePixelRatio, w: c.width, h: c.height, cw: c.clientWidth, ch: c.clientHeight };
    })()`);
    expect(dpr1.dpr).toBe(1);
    expect(dpr1.cw).toBeGreaterThan(0);
    expect(dpr1.ch).toBeGreaterThan(0);
    expect(Math.abs(dpr1.w - Math.round(dpr1.cw * 1))).toBeLessThanOrEqual(2);
    expect(Math.abs(dpr1.h - Math.round(dpr1.ch * 1))).toBeLessThanOrEqual(2);

    await withCdpPage(
      async (hiDpiPage) => {
        await bootApp(hiDpiPage);
        const dpr2 = await hiDpiPage.evaluate<{
          dpr: number;
          w: number;
          h: number;
          cw: number;
          ch: number;
        }>(`(() => {
          const c = window.__e2eUi.getVisibleCanvas();
          return { dpr: window.devicePixelRatio, w: c.width, h: c.height, cw: c.clientWidth, ch: c.clientHeight };
        })()`);
        expect(dpr2.dpr).toBe(2);
        expect(dpr2.cw).toBeGreaterThan(0);
        expect(dpr2.ch).toBeGreaterThan(0);
        expect(Math.abs(dpr2.w - Math.round(dpr2.cw * 2))).toBeLessThanOrEqual(2);
        expect(Math.abs(dpr2.h - Math.round(dpr2.ch * 2))).toBeLessThanOrEqual(2);
      },
      { width: 1280, height: 860, deviceScaleFactor: 2 },
    );
  });

  it('T1-F8-02: touch-action: none is scoped exclusively to <canvas> elements, not ancestors', async () => {
    await bootApp(page);
    const result = await page.evaluate<{
      canvasTouchActions: string[];
      bodyTouchAction: string;
      viewportTouchAction: string;
    }>(`(() => {
      const canvases = Array.from(document.querySelectorAll('canvas'));
      const canvasTouchActions = canvases.map((c) => getComputedStyle(c).touchAction);
      const vp = document.querySelector('.canvas-viewport, main');
      return {
        canvasTouchActions,
        bodyTouchAction: getComputedStyle(document.body).touchAction,
        viewportTouchAction: vp ? getComputedStyle(vp).touchAction : 'auto',
      };
    })()`);

    expect(result.canvasTouchActions.length).toBeGreaterThanOrEqual(4);
    for (const ta of result.canvasTouchActions) {
      expect(ta).toBe('none');
    }
    expect(result.bodyTouchAction).not.toBe('none');
    expect(result.viewportTouchAction).not.toBe('none');
  });

  it('T1-F8-03: Pointer Events pan, wheel zoom, and Reset View update and restore canvas output', async () => {
    await bootApp(page);
    const box = await page.evaluate<{ x: number; y: number; w: number; h: number; hash: number }>(`(() => {
      const c = window.__e2eUi.getVisibleCanvas();
      const r = c.getBoundingClientRect();
      return { x: r.left, y: r.top, w: r.width, h: r.height, hash: window.__e2eUi.getCanvasHash(c).hash };
    })()`);

    const cx = box.x + box.w / 2;
    const cy = box.y + box.h / 2;
    await page.mouseDrag(cx, cy, cx + 60, cy + 40);
    await page.wheel(cx, cy, -240);
    await page.waitFor(
      `window.__e2eUi.getCanvasHash(window.__e2eUi.getVisibleCanvas()).hash !== ${box.hash}`,
    );

    const pannedHash = await page.evaluate<number>(
      'window.__e2eUi.getCanvasHash(window.__e2eUi.getVisibleCanvas()).hash',
    );
    expect(pannedHash).not.toBe(box.hash);

    await page.evaluate('window.__e2eUi.clickControl("Reset View")');
    await page.mouseMove(2, 2);
    await page.waitFor(
      `window.__e2eUi.getCanvasHash(window.__e2eUi.getVisibleCanvas()).hash === ${box.hash}`,
    ).catch(() => undefined);
    await waitRaf(page, 2);
    const resetHash = await page.evaluate<number>(
      'window.__e2eUi.getCanvasHash(window.__e2eUi.getVisibleCanvas()).hash',
    );
    expect(resetHash).toBe(box.hash);
  });

  it('T1-F8-04: hover pointermove updates physical coordinate crosshair readout and clears on pointerleave', async () => {
    await bootApp(page);
    const box = await page.evaluate<{ x: number; y: number; w: number; h: number }>(`(() => {
      const c = window.__e2eUi.getVisibleCanvas();
      const r = c.getBoundingClientRect();
      return { x: r.left, y: r.top, w: r.width, h: r.height };
    })()`);

    await page.mouseMove(box.x + box.w * 0.45, box.y + box.h * 0.5);
    await page.waitFor(
      '(() => { const el = document.querySelector("[data-crosshair-readout], .crosshair-readout, #canvasCrosshair, [id*=\\"crosshair\\" i], [class*=\\"crosshair\\" i]"); return Boolean(el && /[-+]?\\d+/.test((el.textContent || "").trim())); })()',
    ).catch(() => undefined);

    const hoverText = await page.evaluate<string>(`(() => {
      const el = document.querySelector('[data-crosshair-readout], .crosshair-readout, #canvasCrosshair, [id*="crosshair" i], [class*="crosshair" i]');
      return el ? (el.textContent || '').trim() : '';
    })()`);
    expect(hoverText.length).toBeGreaterThan(0);
    expect(hoverText).toMatch(/[-+]?\d+/);

    await page.mouseMove(2, 2);
    await page.waitFor(
      '(() => { const el = document.querySelector("[data-crosshair-readout], .crosshair-readout, #canvasCrosshair, [id*=\\"crosshair\\" i], [class*=\\"crosshair\\" i]"); if (!el || getComputedStyle(el).display === "none" || el.hidden) return true; return !/\\d/.test((el.textContent || "").trim()); })()',
    ).catch(() => undefined);
    const afterLeave = await page.evaluate<string>(`(() => {
      const el = document.querySelector('[data-crosshair-readout], .crosshair-readout, #canvasCrosshair, [id*="crosshair" i], [class*="crosshair" i]');
      if (!el) return '';
      if (getComputedStyle(el).display === 'none' || el.hidden) return '';
      return (el.textContent || '').trim();
    })()`);
    expect(afterLeave).not.toBe(hoverText);
    expect(afterLeave === '' || !/\d/.test(afterLeave)).toBe(true);
  });

  it('T1-F8-05: PNG export produces valid image/png blob and numeric table toggle renders semantic <table>', async () => {
    await bootApp(page);
    const pngAndTable = await page.evaluate<{
      hasPngBtn: boolean;
      exportTriggered: boolean;
      pngHeaderOk: boolean;
      tableVisible: boolean;
      hasCaption: boolean;
      hasThScopeCol: boolean;
      rowCount: number;
    }>(`(async () => {
      const capturedBlobs = [];
      const clickedDownloads = [];
      const origCreateObjectURL = URL.createObjectURL.bind(URL);
      const origAnchorClick = HTMLAnchorElement.prototype.click;

      URL.createObjectURL = (obj) => {
        if (obj instanceof Blob) capturedBlobs.push(obj);
        return origCreateObjectURL(obj);
      };
      HTMLAnchorElement.prototype.click = function () {
        clickedDownloads.push({ download: this.download || '', href: this.href || '' });
      };

      let hasPngBtn = false;
      try {
        hasPngBtn = window.__e2eUi.clickControl(
          'Export PNG|PNG',
          '[role="tabpanel"]:not([hidden]), .canvas-tab-panel.active, .canvas-actions, .canvas-header',
        );
        await new Promise((r) => setTimeout(r, 100));
      } finally {
        URL.createObjectURL = origCreateObjectURL;
        HTMLAnchorElement.prototype.click = origAnchorClick;
      }

      let pngHeaderOk = false;
      const pngBlob = capturedBlobs.find((b) => b.type === 'image/png') || capturedBlobs[0];
      if (pngBlob) {
        const buf = new Uint8Array(await pngBlob.arrayBuffer());
        pngHeaderOk = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
      } else {
        const dataLink = clickedDownloads.find((d) => d.href.startsWith('data:image/png'));
        if (dataLink) {
          const b64 = dataLink.href.split(',')[1] || '';
          const bin = atob(b64.slice(0, 12));
          pngHeaderOk =
            bin.charCodeAt(0) === 0x89 &&
            bin.charCodeAt(1) === 0x50 &&
            bin.charCodeAt(2) === 0x4e &&
            bin.charCodeAt(3) === 0x47;
        }
      }

      const exportTriggered = Boolean(pngBlob || clickedDownloads.some((d) => /\\.png$/i.test(d.download) || d.href.startsWith('data:image/png')));
      const clickedTable = window.__e2eUi.clickControl(
        'Table|Numeric|Data Table',
        '[role="tabpanel"]:not([hidden]), .canvas-tab-panel.active, .canvas-actions, .canvas-header',
      );
      const table = window.__e2eUi.getActiveTable();
      return {
        hasPngBtn,
        exportTriggered,
        pngHeaderOk,
        tableVisible: Boolean(clickedTable && table && window.__e2eUi.isVisible(table)),
        hasCaption: Boolean(table && table.querySelector('caption')),
        hasThScopeCol: Boolean(table && table.querySelector('th[scope="col"]')),
        rowCount: table ? table.querySelectorAll('tbody tr, tr').length : 0,
      };
    })()`);

    expect(pngAndTable.hasPngBtn).toBe(true);
    expect(pngAndTable.exportTriggered).toBe(true);
    expect(pngAndTable.pngHeaderOk).toBe(true);
    expect(pngAndTable.tableVisible).toBe(true);
    expect(pngAndTable.hasCaption).toBe(true);
    expect(pngAndTable.hasThScopeCol).toBe(true);
    expect(pngAndTable.rowCount).toBeGreaterThan(1);
  });

  it('T2-F8-01: resizing while a tab is hidden never destroys backing store and paints crisply when revealed', async () => {
    await bootApp(page);
    await page.setViewport(980, 720, 1);
    await waitRaf(page, 2);
    await page.evaluate('window.__e2eUi.selectTab("isofluence|chart 1")');
    await page.waitFor(
      '(window.__e2eUi.getCanvasHash(window.__e2eUi.getVisibleCanvas())?.distinctColors || 0) > 1',
    );
    const stats = await page.evaluate<{ width: number; height: number; distinctColors: number }>(
      'window.__e2eUi.getCanvasHash(window.__e2eUi.getVisibleCanvas())',
    );
    expect(stats.width).toBeGreaterThan(100);
    expect(stats.height).toBeGreaterThan(100);
    expect(stats.distinctColors).toBeGreaterThan(1);
    expect(page.pageErrors).toEqual([]);
  });

  it('T2-F8-02: narrow mobile viewport (320x568) keeps canvas positive without horizontal document overflow or errors', async () => {
    await bootApp(page);
    await page.setViewport(320, 568, 1);
    await page.waitFor('document.documentElement.clientWidth <= 325');
    await waitRaf(page, 2);
    const res = await page.evaluate<{ width: number; height: number; scrollW: number; clientW: number }>(`(() => {
      const c = window.__e2eUi.getVisibleCanvas();
      return {
        width: c ? c.width : 0,
        height: c ? c.height : 0,
        scrollW: document.documentElement.scrollWidth,
        clientW: document.documentElement.clientWidth,
      };
    })()`);
    await page.setViewport(1280, 860, 1);
    expect(res.width).toBeGreaterThan(0);
    expect(res.height).toBeGreaterThan(0);
    expect(res.scrollW).toBeLessThanOrEqual(res.clientW + 2);
    expect(page.pageErrors).toEqual([]);
  });

  it('T2-F8-03: multi-pointer pinch-zoom and pointercancel clean up without stuck drag state', async () => {
    await bootApp(page);
    const box = await page.evaluate<{ x: number; y: number; w: number; h: number }>(`(() => {
      const c = window.__e2eUi.getVisibleCanvas();
      const r = c.getBoundingClientRect();
      return { x: r.left, y: r.top, w: r.width, h: r.height };
    })()`);

    const cx = box.x + box.w / 2;
    const cy = box.y + box.h / 2;
    await page.mouseMove(2, 2);
    await waitRaf(page, 2);

    await page.touchPinchAndCancel(cx, cy);
    await page.mouseMove(2, 2);
    await waitRaf(page, 2);
    const postCancelStats = await page.evaluate<{ hash: number; distinctColors: number }>(
      'window.__e2eUi.getCanvasHash(window.__e2eUi.getVisibleCanvas())',
    );
    expect(postCancelStats.distinctColors).toBeGreaterThan(1);

    // Moving mouse without button down must NOT pan (proves no stuck drag state after pointercancel)
    await page.mouseMove(cx, cy);
    await page.mouseMove(cx + 80, cy + 50);
    await page.mouseMove(2, 2);
    await waitRaf(page, 2);
    const afterMoveHash = await page.evaluate<number>(
      'window.__e2eUi.getCanvasHash(window.__e2eUi.getVisibleCanvas()).hash',
    );
    expect(afterMoveHash).toBe(postCancelStats.hash);

    // Normal mouseDrag afterwards should still pan cleanly
    await page.mouseDrag(cx, cy, cx + 60, cy + 40);
    await page.mouseMove(2, 2);
    await page.waitFor(
      `window.__e2eUi.getCanvasHash(window.__e2eUi.getVisibleCanvas()).hash !== ${postCancelStats.hash}`,
    );
    const afterDragHash = await page.evaluate<number>(
      'window.__e2eUi.getCanvasHash(window.__e2eUi.getVisibleCanvas()).hash',
    );
    expect(afterDragHash).not.toBe(postCancelStats.hash);
    expect(page.pageErrors).toEqual([]);
  });

  it('T2-F8-04: extreme wheel zoom-in and zoom-out clamp safely without blank canvas or NaN crash', async () => {
    await bootApp(page);
    const box = await page.evaluate<{ x: number; y: number; w: number; h: number }>(`(() => {
      const c = window.__e2eUi.getVisibleCanvas();
      const r = c.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
    })()`);

    for (let i = 0; i < 15; i++) {
      await page.wheel(box.x, box.y, -300);
    }
    await waitRaf(page, 2);
    const zoomedIn = await page.evaluate<{ distinctColors: number }>(
      'window.__e2eUi.getCanvasHash(window.__e2eUi.getVisibleCanvas())',
    );
    expect(zoomedIn.distinctColors).toBeGreaterThan(1);

    for (let i = 0; i < 30; i++) {
      await page.wheel(box.x, box.y, 300);
    }
    await waitRaf(page, 2);
    const zoomedOut = await page.evaluate<{ distinctColors: number }>(
      'window.__e2eUi.getCanvasHash(window.__e2eUi.getVisibleCanvas())',
    );
    expect(zoomedOut.distinctColors).toBeGreaterThan(1);
    expect(page.pageErrors).toEqual([]);
  });

  it('T2-F8-05: numeric summary table formats NaN entries cleanly when peak fluence is below threshold', async () => {
    await bootApp(page);
    await page.evaluate('window.__e2eUi.setInputValue("#overrideAblationThresh", 300)');
    await page.waitFor(
      'parseFloat(document.querySelector("#metricThresholdR")?.textContent || "1") === 0',
    );
    await page.evaluate('window.__e2eUi.selectTab("isofluence|chart 1")');
    await waitRaf(page, 2);
    await page.evaluate('window.__e2eUi.clickControl("Table|Numeric", "[role=\\"tabpanel\\"]:not([hidden]), .canvas-tab-panel.active, .canvas-actions, .canvas-header")');
    const tableText = await page.evaluate<string>(
      'window.__e2eUi.getActiveTable()?.textContent || ""',
    );
    expect(tableText.length).toBeGreaterThan(0);
    expect(tableText).not.toContain('undefined');
    expect(tableText).not.toContain('NaN');
  });

  it('T1-F9-01: Tab 1 (Chart 2) Cross-Section paints beam envelopes and 2-plane nozzle bore', async () => {
    await bootApp(page);
    await page.evaluate('window.__e2eUi.selectTab("profile|cross")');
    await waitRaf(page, 2);
    const stats = await page.evaluate<{ distinctColors: number; lumaSpread: number }>(
      'window.__e2eUi.getCanvasHash(window.__e2eUi.getVisibleCanvas())',
    );
    expect(stats.distinctColors).toBeGreaterThan(2);
    expect(stats.lumaSpread).toBeGreaterThan(20);
  });

  it('T1-F9-02: Tab 1 Vertical/Horizontal Z orientation toggle rotates rendered cross-section', async () => {
    await bootApp(page);
    const before = await page.evaluate<number>(
      'window.__e2eUi.getCanvasHash(window.__e2eUi.getVisibleCanvas()).hash',
    );
    await page.evaluate('window.__e2eUi.clickControl("#btnOrientation|Vertical Z|Horizontal Z")');
    await page.waitFor(
      `window.__e2eUi.getCanvasHash(window.__e2eUi.getVisibleCanvas()).hash !== ${before}`,
    );
    const after = await page.evaluate<number>(
      'window.__e2eUi.getCanvasHash(window.__e2eUi.getVisibleCanvas()).hash',
    );
    const btnText = await page.evaluate<string>(
      'document.querySelector("#btnOrientation")?.textContent || ""',
    );
    expect(after).not.toBe(before);
    expect(btnText.toLowerCase()).toContain('horizontal');
  });

  it('T1-F9-03: Tab 1 180-deg ghost counter-beam toggle draws mirrored beam without mutating metrics', async () => {
    await bootApp(page);
    const before = await page.evaluate<{ hash: number; spot: string }>(`({
      hash: window.__e2eUi.getCanvasHash(window.__e2eUi.getVisibleCanvas()).hash,
      spot: document.querySelector('#metricSpotSize')?.textContent || '',
    })`);
    const toggled = await page.evaluate<boolean>(
      'window.__e2eUi.clickControl("Counter[-\\\\s]?Beam|Ghost\\\\s*Beam|180\\\\s*°?\\\\s*(?:Counter|Ghost)|#toggleCounterBeam|#chkCounterBeam", "[role=\\"tabpanel\\"]:not([hidden]), .canvas-tab-panel.active, .canvas-actions, .canvas-header")',
    );
    expect(toggled, 'Missing 180-deg counter-beam toggle').toBe(true);
    await page.waitFor(
      `window.__e2eUi.getCanvasHash(window.__e2eUi.getVisibleCanvas()).hash !== ${before.hash}`,
    );
    const after = await page.evaluate<{ hash: number; spot: string }>(`({
      hash: window.__e2eUi.getCanvasHash(window.__e2eUi.getVisibleCanvas()).hash,
      spot: document.querySelector('#metricSpotSize')?.textContent || '',
    })`);
    expect(after.hash).not.toBe(before.hash);
    expect(after.spot).toBe(before.spot);
  });

  it('T1-F9-04: Tab 1 Graph Limit Expansion (Z Min/Max, R Min/Max) updates viewport framing', async () => {
    await bootApp(page);
    const before = await page.evaluate<number>(
      'window.__e2eUi.getCanvasHash(window.__e2eUi.getVisibleCanvas()).hash',
    );
    await page.evaluate(`(() => {
      window.__e2eUi.setInputValue('Z Min', -1000);
      window.__e2eUi.setInputValue('Z Max', 2500);
      window.__e2eUi.setInputValue('R Min', -200);
      window.__e2eUi.setInputValue('R Max', 300);
    })()`);
    await page.waitFor(
      `window.__e2eUi.getCanvasHash(window.__e2eUi.getVisibleCanvas()).hash !== ${before}`,
    );
    const after = await page.evaluate<number>(
      'window.__e2eUi.getCanvasHash(window.__e2eUi.getVisibleCanvas()).hash',
    );
    expect(after).not.toBe(before);
  });

  it('T1-F9-05: Tab 2 mode switcher (Beam Path, 1/e2, Ablation, All) and Nozzle rings render distinct frames', async () => {
    await bootApp(page);
    await page.evaluate('window.__e2eUi.selectTab("topdown|multi|3d")');
    await waitRaf(page, 2);

    const hashes = new Set<number>();
    for (const mode of ['Beam Path', '1/e', 'Ablation', 'All']) {
      const clicked = await page.evaluate<boolean>(`(() => {
        const sel = document.querySelector('#panelTopDown select, #selectTopDownMode');
        if (sel) {
          const opt = Array.from(sel.options).find((o) => new RegExp('${mode}', 'i').test(o.text));
          if (opt) { sel.value = opt.value; sel.dispatchEvent(new Event('change', { bubbles: true })); return true; }
        }
        return window.__e2eUi.clickControl('${mode}', '#panelTopDown, [role="tabpanel"]:not([hidden]), .canvas-actions');
      })()`);
      expect(clicked, `Tab 2 mode control not found: ${mode}`).toBe(true);
      await waitRaf(page, 2);
      const h = await page.evaluate<number>(
        'window.__e2eUi.getCanvasHash(window.__e2eUi.getVisibleCanvas()).hash',
      );
      hashes.add(h);
    }
    expect(hashes.size).toBeGreaterThanOrEqual(3);

    const beforeNozzle = await page.evaluate<number>(
      'window.__e2eUi.getCanvasHash(window.__e2eUi.getVisibleCanvas()).hash',
    );
    const nozzleToggled = await page.evaluate<boolean>(
      'window.__e2eUi.clickControl("Nozzle", "#panelTopDown, [role=\\"tabpanel\\"]:not([hidden]), .canvas-actions")',
    );
    expect(nozzleToggled, 'Missing Nozzle ring toggle on Tab 2').toBe(true);
    await page.waitFor(
      `window.__e2eUi.getCanvasHash(window.__e2eUi.getVisibleCanvas()).hash !== ${beforeNozzle}`,
    );
    const afterNozzle = await page.evaluate<number>(
      'window.__e2eUi.getCanvasHash(window.__e2eUi.getVisibleCanvas()).hash',
    );
    expect(afterNozzle).not.toBe(beforeNozzle);
  });

  it('T1-F9-06: Tab 2 orbit angle scrubber and Transition Safety Heatmap render and respond dynamically', async () => {
    await bootApp(page);
    await page.evaluate('window.__e2eUi.clickControl("#radioTransitionState|Transition")');
    await page.evaluate('window.__e2eUi.selectTab("topdown|multi|3d")');
    await page.waitFor(
      '(() => { const s = document.querySelector("#canvasSafetyHeatmap, [data-safety-heatmap], .safety-heatmap, [id*=\\"heatmap\\" i]"); return Boolean(s && window.__e2eUi.isVisible(s)); })()',
    );
    await waitRaf(page, 2);

    const heatmapExists = await page.evaluate<boolean>(`(() => {
      const strip = document.querySelector('[data-safety-heatmap], .safety-heatmap, canvas[id*="heatmap" i], [id*="heatmap" i]');
      return Boolean(strip);
    })()`);
    expect(heatmapExists, 'Missing Transition Safety Heatmap strip').toBe(true);

    const before = await page.evaluate<number>(
      'window.__e2eUi.getCanvasHash(window.__e2eUi.getVisibleCanvas()).hash',
    );
    await page.evaluate(`(() => {
      const orbit = document.querySelector('#sliderOrbitAngle, #sliderOrbit, input[type="range"][id*="orbit" i], input[type="range"][aria-label*="orbit" i]');
      if (!orbit) throw new Error('Missing orbit scrubber slider on Tab 2');
      orbit.value = String(Math.round(Number(orbit.max || 360) / 2));
      orbit.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await page.waitFor(
      `window.__e2eUi.getCanvasHash(window.__e2eUi.getVisibleCanvas()).hash !== ${before}`,
    );
    const after = await page.evaluate<number>(
      'window.__e2eUi.getCanvasHash(window.__e2eUi.getVisibleCanvas()).hash',
    );
    expect(after).not.toBe(before);
  });

  it('T2-F9-01: Tab 1 inverted Graph Limits (Z Min >= Z Max) guard against blank/broken canvas', async () => {
    await bootApp(page);
    await page.evaluate(`(() => {
      window.__e2eUi.setInputValue('Z Min', 1500);
      window.__e2eUi.setInputValue('Z Max', -500);
      window.__e2eUi.setInputValue('R Min', 200);
      window.__e2eUi.setInputValue('R Max', -200);
    })()`);
    await waitRaf(page, 2);
    const stats = await page.evaluate<{ distinctColors: number }>(
      'window.__e2eUi.getCanvasHash(window.__e2eUi.getVisibleCanvas())',
    );
    expect(stats.distinctColors).toBeGreaterThan(1);
    expect(page.pageErrors).toEqual([]);
  });

  it('T2-F9-02: Tab 1 renders cleanly with 180-deg counter-beam + Horizontal Z + focus_rel_z = 300', async () => {
    await bootApp(page);
    await page.evaluate(`(() => {
      window.__e2eUi.setInputValue('#overrideFocusRelZ', 300);
      window.__e2eUi.clickControl('#btnOrientation|Vertical Z|Horizontal Z');
      window.__e2eUi.clickControl('Counter[-\\\\s]?Beam|Ghost\\\\s*Beam|180\\\\s*°?\\\\s*(?:Counter|Ghost)|#toggleCounterBeam|#chkCounterBeam', '[role="tabpanel"]:not([hidden]), .canvas-tab-panel.active, .canvas-actions, .canvas-header');
    })()`);
    await page.waitFor(
      'document.querySelector("#btnOrientation")?.textContent?.toLowerCase().includes("horizontal")',
    );
    await waitRaf(page, 2);
    const stats = await page.evaluate<{ distinctColors: number }>(
      'window.__e2eUi.getCanvasHash(window.__e2eUi.getVisibleCanvas())',
    );
    expect(stats.distinctColors).toBeGreaterThan(2);
    expect(page.pageErrors).toEqual([]);
  });

  it('T2-F9-03: Tab 2 Ablation Contour mode handles all-NaN below-threshold state without crashing', async () => {
    await bootApp(page);
    await page.evaluate('window.__e2eUi.setInputValue("#overrideAblationThresh", 300)');
    await page.waitFor(
      'parseFloat(document.querySelector("#metricThresholdR")?.textContent || "1") === 0',
    );
    await page.evaluate('window.__e2eUi.selectTab("topdown|multi|3d")');
    await page.evaluate(`(() => {
      if (!window.__e2eUi.selectOptionByText('#panelTopDown select, #selectTopDownMode', 'Ablation')) {
        window.__e2eUi.clickControl("Ablation", "#panelTopDown, [role=\\"tabpanel\\"]:not([hidden]), .canvas-actions");
      }
    })()`);
    await waitRaf(page, 2);
    const stats = await page.evaluate<{ distinctColors: number }>(
      'window.__e2eUi.getCanvasHash(window.__e2eUi.getVisibleCanvas())',
    );
    expect(stats.distinctColors).toBeGreaterThan(1);
    expect(page.pageErrors).toEqual([]);
  });

  it('T2-F9-04: Tab 2 orbit scrubber boundaries (0 and max) wrap seamlessly without errors', async () => {
    await bootApp(page);
    await page.evaluate('window.__e2eUi.selectTab("topdown|multi|3d")');
    await waitRaf(page, 2);
    const hashes = await page.evaluate<[number, number]>(`(async () => {
      const orbit = document.querySelector('#sliderOrbitAngle, #sliderOrbit, input[type="range"][id*="orbit" i], input[type="range"][aria-label*="orbit" i]');
      if (!orbit) throw new Error('Missing orbit scrubber');
      orbit.value = orbit.min || '0';
      orbit.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const h0 = window.__e2eUi.getCanvasHash(window.__e2eUi.getVisibleCanvas()).hash;
      orbit.value = orbit.max || '360';
      orbit.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const h1 = window.__e2eUi.getCanvasHash(window.__e2eUi.getVisibleCanvas()).hash;
      return [h0, h1];
    })()`);
    expect(hashes[0]).toBeGreaterThan(0);
    expect(hashes[1]).toBeGreaterThan(0);
    expect(page.pageErrors).toEqual([]);
  });

  it('T2-F9-05: Transition scrubber box activates only in Transition mode and steps across 0/50/100', async () => {
    await bootApp(page);
    const singleVisible = await page.evaluate<boolean>(
      'getComputedStyle(document.querySelector("#transitionControlsBox")).display !== "none"',
    );
    expect(singleVisible).toBe(false);

    await page.evaluate('window.__e2eUi.clickControl("#radioTransitionState|Transition")');
    await page.waitFor(
      'getComputedStyle(document.querySelector("#transitionControlsBox")).display !== "none"',
    );
    const transVisible = await page.evaluate<boolean>(
      'getComputedStyle(document.querySelector("#transitionControlsBox")).display !== "none"',
    );
    expect(transVisible).toBe(true);

    for (const p of [0, 50, 100]) {
      await page.evaluate(`window.__e2eUi.setInputValue('#sliderProgress', ${p})`);
      await page.waitFor(
        `(document.querySelector("#textProgress")?.textContent || "").includes("${p}")`,
      );
      const txt = await page.evaluate<string>(
        'document.querySelector("#textProgress")?.textContent || ""',
      );
      expect(txt).toContain(String(p));
    }
  });

  it('T2-F9-06: Tab 2 Square Hole with Scanlab PrecSYS renders distinct square geometry cleanly', async () => {
    await bootApp(page);
    await page.evaluate('window.__e2eUi.selectTab("topdown|multi|3d")');
    await waitRaf(page, 2);
    const roundHash = await page.evaluate<number>(
      'window.__e2eUi.getCanvasHash(window.__e2eUi.getVisibleCanvas()).hash',
    );
    await page.evaluate('window.__e2eUi.setInputValue("#selectHoleType", "square")');
    await page.waitFor(
      `window.__e2eUi.getCanvasHash(window.__e2eUi.getVisibleCanvas()).hash !== ${roundHash}`,
    );
    const squareHash = await page.evaluate<number>(
      'window.__e2eUi.getCanvasHash(window.__e2eUi.getVisibleCanvas()).hash',
    );
    expect(squareHash).not.toBe(roundHash);
    expect(page.pageErrors).toEqual([]);
  });

  it('T1-F10-01: Tab 3 (Chart 1) Isofluence Lines renders non-blank isofluence contours', async () => {
    await bootApp(page);
    await page.evaluate('window.__e2eUi.selectTab("isofluence|chart 1")');
    await waitRaf(page, 2);
    const stats = await page.evaluate<{ distinctColors: number; lumaSpread: number }>(
      'window.__e2eUi.getCanvasHash(window.__e2eUi.getVisibleCanvas())',
    );
    expect(stats.distinctColors).toBeGreaterThan(2);
    expect(stats.lumaSpread).toBeGreaterThan(20);
  });

  it('T1-F10-02: Tab 3 contour toggles including Thermal Damage (I/64) redraw canvas dynamically', async () => {
    await bootApp(page);
    await page.evaluate('window.__e2eUi.selectTab("isofluence|chart 1")');
    await waitRaf(page, 2);
    const before = await page.evaluate<number>(
      'window.__e2eUi.getCanvasHash(window.__e2eUi.getVisibleCanvas()).hash',
    );
    const toggled = await page.evaluate<boolean>(
      'window.__e2eUi.clickControl("Thermal|I/64", "#panelIsofluence, [role=\\"tabpanel\\"]:not([hidden]), .canvas-actions")',
    );
    expect(toggled, 'Missing Thermal Damage (I/64) contour toggle').toBe(true);
    await page.waitFor(
      `window.__e2eUi.getCanvasHash(window.__e2eUi.getVisibleCanvas()).hash !== ${before}`,
    );
    const after = await page.evaluate<number>(
      'window.__e2eUi.getCanvasHash(window.__e2eUi.getVisibleCanvas()).hash',
    );
    expect(after).not.toBe(before);
  });

  it('T1-F10-03: Tab 3 live Z From Focus marker and ablated diameter readout update when Z=150', async () => {
    const presets = await loadPresetsContract();
    const tsCompute = await loadTsEngineContract();
    const expectedInput = cloneDefaultInput(presets);
    expectedInput.zFromFocusLookup_um = 150;
    const expectedAt150 = tsCompute(expectedInput).scalars.ablatedSpotAtLookupZ_um;

    await bootApp(page);
    await page.evaluate('window.__e2eUi.expandDetailsFor("#readoutAblatedAtZ")');
    await page.evaluate('window.__e2eUi.selectTab("isofluence|chart 1")');
    await waitRaf(page, 2);
    const initialReadout = await page.evaluate<string>('window.__e2eUi.getZLookupReadout()');
    const before = await page.evaluate<number>(
      'window.__e2eUi.getCanvasHash(window.__e2eUi.getVisibleCanvas()).hash',
    );
    await page.evaluate('window.__e2eUi.setInputValue("Z From Focus", 150)');
    await page.waitFor(
      `window.__e2eUi.getCanvasHash(window.__e2eUi.getVisibleCanvas()).hash !== ${before} && window.__e2eUi.getZLookupReadout() !== ${JSON.stringify(initialReadout)}`,
    );
    const after = await page.evaluate<number>(
      'window.__e2eUi.getCanvasHash(window.__e2eUi.getVisibleCanvas()).hash',
    );
    const readout = await page.evaluate<string>('window.__e2eUi.getZLookupReadout()');
    expect(after).not.toBe(before);
    expect(readout.length, 'Missing Z From Focus ablated spot diameter readout').toBeGreaterThan(0);
    expect(readout).not.toMatch(/NaN|undefined|Infinity/i);
    const numMatch = readout.match(/[-+]?\d+(?:\.\d+)?/);
    expect(numMatch, `Expected numeric diameter in readout: "${readout}"`).not.toBeNull();
    expectClose(Number(numMatch![0]), expectedAt150, 0.05, 'Z=150 ablated spot readout');
  });

  it('T1-F10-04: Tab 4 (Chart 6) Focus Energy Distribution renders Gaussian and Ablation vs No-Ablation shading', async () => {
    await bootApp(page);
    await page.evaluate('window.__e2eUi.selectTab("fluence|distribution|chart 6")');
    await waitRaf(page, 2);
    const stats = await page.evaluate<{ distinctColors: number; lumaSpread: number }>(
      'window.__e2eUi.getCanvasHash(window.__e2eUi.getVisibleCanvas())',
    );
    expect(stats.distinctColors).toBeGreaterThan(2);
    expect(stats.lumaSpread).toBeGreaterThan(20);
  });

  it('T1-F10-05: Tab 4 Normalized vs J/cm2 unit toggle switches Y-axis and numeric table values', async () => {
    await bootApp(page);
    await page.evaluate('window.__e2eUi.selectTab("fluence|distribution|chart 6")');
    await waitRaf(page, 2);
    const before = await page.evaluate<number>(
      'window.__e2eUi.getCanvasHash(window.__e2eUi.getVisibleCanvas()).hash',
    );
    const toggled = await page.evaluate<boolean>(`(() => {
      if (window.__e2eUi.selectOptionByText('#panelFluence select, #selectFluenceUnit', 'J/cm|Fluence')) {
        return true;
      }
      return window.__e2eUi.clickControl('J/cm|Fluence|Unit', '#panelFluence, [role="tabpanel"]:not([hidden]), .canvas-actions');
    })()`);
    expect(toggled, 'Missing Normalized vs J/cm2 unit toggle on Tab 4').toBe(true);
    await page.waitFor(
      `window.__e2eUi.getCanvasHash(window.__e2eUi.getVisibleCanvas()).hash !== ${before}`,
    );
    const after = await page.evaluate<number>(
      'window.__e2eUi.getCanvasHash(window.__e2eUi.getVisibleCanvas()).hash',
    );
    expect(after).not.toBe(before);
  });

  it('T2-F10-01: Tab 3 renders axes and Z marker cleanly when all contour checkboxes are toggled OFF', async () => {
    await bootApp(page);
    await page.evaluate('window.__e2eUi.selectTab("isofluence|chart 1")');
    await waitRaf(page, 2);
    const before = await page.evaluate<number>(
      'window.__e2eUi.getCanvasHash(window.__e2eUi.getVisibleCanvas()).hash',
    );
    await page.evaluate(`(() => {
      const roots = document.querySelectorAll('#panelIsofluence, [role="tabpanel"]:not([hidden]), .canvas-actions');
      for (const root of roots) {
        for (const cb of root.querySelectorAll('input[type="checkbox"]')) {
          if (cb.checked) cb.click();
        }
      }
    })()`);
    await page.waitFor(
      `window.__e2eUi.getCanvasHash(window.__e2eUi.getVisibleCanvas()).hash !== ${before}`,
    );
    const stats = await page.evaluate<{ distinctColors: number }>(
      'window.__e2eUi.getCanvasHash(window.__e2eUi.getVisibleCanvas())',
    );
    expect(stats.distinctColors).toBeGreaterThan(1);
    expect(page.pageErrors).toEqual([]);
  });

  it('T2-F10-02: Tab 3 Z From Focus beyond z_max (9999 um) handles no-ablation readout cleanly', async () => {
    await bootApp(page);
    await page.evaluate('window.__e2eUi.expandDetailsFor("#readoutAblatedAtZ")');
    await page.evaluate('window.__e2eUi.selectTab("isofluence|chart 1")');
    await page.evaluate('window.__e2eUi.setInputValue("Z From Focus", 9999)');
    await page.waitFor(
      '/no\\s*ablation|below\\s*thresh|none/i.test(window.__e2eUi.getZLookupReadout())',
    );
    await waitRaf(page, 2);
    const readout = await page.evaluate<string>('window.__e2eUi.getZLookupReadout()');
    const stats = await page.evaluate<{ distinctColors: number }>(
      'window.__e2eUi.getCanvasHash(window.__e2eUi.getVisibleCanvas())',
    );
    expect(readout.length, 'Missing Z From Focus readout for Z=9999').toBeGreaterThan(0);
    expect(readout).not.toMatch(/NaN|undefined|Infinity/i);
    expect(readout).toMatch(/no\s*ablation|below\s*thresh|none|^0(?:\.0+)?\s*(?:µm|um)?$|^—$|^--$/i);
    expect(stats.distinctColors).toBeGreaterThan(1);
    expect(page.pageErrors).toEqual([]);
  });

  it('T2-F10-03: Tab 3 Isofluence handles NaN contour breaks cleanly without crashing', async () => {
    await bootApp(page);
    await page.evaluate('window.__e2eUi.selectTab("isofluence|chart 1")');
    await waitRaf(page, 2);
    const stats = await page.evaluate<{ distinctColors: number }>(
      'window.__e2eUi.getCanvasHash(window.__e2eUi.getVisibleCanvas())',
    );
    expect(stats.distinctColors).toBeGreaterThan(2);
    expect(page.pageErrors).toEqual([]);
  });

  it('T2-F10-04: Tab 4 all-No-Ablation (F_th >= F_0) renders cleanly in both Normalized and J/cm2 modes', async () => {
    await bootApp(page);
    await page.evaluate('window.__e2eUi.setInputValue("#overrideAblationThresh", 300)');
    await page.waitFor(
      'parseFloat(document.querySelector("#metricThresholdR")?.textContent || "1") === 0',
    );
    await page.evaluate('window.__e2eUi.selectTab("fluence|distribution|chart 6")');
    await waitRaf(page, 2);
    const s1 = await page.evaluate<{ hash: number; distinctColors: number }>(
      'window.__e2eUi.getCanvasHash(window.__e2eUi.getVisibleCanvas())',
    );
    const switched = await page.evaluate<boolean>(`(() => {
      if (window.__e2eUi.selectOptionByText('#panelFluence select, #selectFluenceUnit', 'J/cm|Fluence')) {
        return true;
      }
      return window.__e2eUi.clickControl('J/cm|Fluence|Unit', '#panelFluence, [role="tabpanel"]:not([hidden]), .canvas-actions');
    })()`);
    expect(switched).toBe(true);
    await page.waitFor(
      `window.__e2eUi.getCanvasHash(window.__e2eUi.getVisibleCanvas()).hash !== ${s1.hash}`,
    );
    const s2 = await page.evaluate<{ hash: number; distinctColors: number }>(
      'window.__e2eUi.getCanvasHash(window.__e2eUi.getVisibleCanvas())',
    );
    expect(s1.distinctColors).toBeGreaterThan(1);
    expect(s2.distinctColors).toBeGreaterThan(1);
    expect(s2.hash).not.toBe(s1.hash);
    expect(page.pageErrors).toEqual([]);
  });

  it('T2-F10-05: Tab 4 narrow ablation tip (F_th = 0.99 * F_0) updates thresholdR and plot cleanly', async () => {
    await bootApp(page);
    await page.evaluate('window.__e2eUi.setInputValue("#overrideAblationThresh", 188.1)');
    await page.waitFor(
      '(() => { const v = parseFloat(document.querySelector("#metricThresholdR")?.textContent || "0"); return v > 0 && v < 0.2; })()',
    );
    await page.evaluate('window.__e2eUi.selectTab("fluence|distribution|chart 6")');
    await waitRaf(page, 2);
    const stats = await page.evaluate<{ distinctColors: number }>(
      'window.__e2eUi.getCanvasHash(window.__e2eUi.getVisibleCanvas())',
    );
    expect(stats.distinctColors).toBeGreaterThan(1);
    expect(page.pageErrors).toEqual([]);
  });

  it('T1-F11-01: light/dark theme toggle updates dataset.theme, computed background, and canvas palette using light-dark()', async () => {
    await bootApp(page, { clearStorage: true });
    const distAssets = walkFiles(resolveWorkspacePath('dist/assets')).filter((f) => f.endsWith('.css'));
    const hasLightDarkInDistCss = distAssets.some((f) =>
      fs.readFileSync(resolveWorkspacePath('dist/assets', f), 'utf8').includes('light-dark('),
    );
    const hasLightDarkInStyleSheets = await page.evaluate<boolean>(`(() => {
      for (const sheet of Array.from(document.styleSheets)) {
        try {
          for (const rule of Array.from(sheet.cssRules || [])) {
            if (rule.cssText && rule.cssText.includes('light-dark(')) return true;
          }
        } catch {}
      }
      return false;
    })()`);
    expect(hasLightDarkInDistCss || hasLightDarkInStyleSheets, 'CSS missing light-dark() rules').toBe(true);

    const initial = await page.evaluate<{ theme: string; bg: string; hash: number }>(`({
      theme: document.documentElement.dataset.theme || '',
      bg: getComputedStyle(document.body).backgroundColor,
      hash: window.__e2eUi.getCanvasHash(window.__e2eUi.getVisibleCanvas()).hash,
    })`);
    expect(['dark', 'light']).toContain(initial.theme);

    await page.evaluate('document.querySelector("#btnToggleTheme").click()');
    await page.waitFor(
      `document.documentElement.dataset.theme !== ${JSON.stringify(initial.theme)} && window.__e2eUi.getCanvasHash(window.__e2eUi.getVisibleCanvas()).hash !== ${initial.hash}`,
    );

    const toggled = await page.evaluate<{ theme: string; bg: string; hash: number }>(`({
      theme: document.documentElement.dataset.theme || '',
      bg: getComputedStyle(document.body).backgroundColor,
      hash: window.__e2eUi.getCanvasHash(window.__e2eUi.getVisibleCanvas()).hash,
    })`);

    expect(toggled.theme).toBe(initial.theme === 'dark' ? 'light' : 'dark');
    expect(toggled.bg).not.toBe(initial.bg);
    expect(toggled.hash).not.toBe(initial.hash);
  });

  it('T1-F11-02: DOM contains single <main>, <details>/<summary>, inline SVG schematics, and MathML with zero $...$ LaTeX', async () => {
    await bootApp(page);
    const structure = await page.evaluate<{
      mainCount: number;
      detailsCount: number;
      svgCount: number;
      mathCount: number;
      hasRawLatex: boolean;
    }>(`(() => {
      const text = document.body.textContent || '';
      return {
        mainCount: document.querySelectorAll('main').length,
        detailsCount: document.querySelectorAll('details > summary').length,
        svgCount: document.querySelectorAll('svg').length,
        mathCount: document.querySelectorAll('math').length,
        hasRawLatex: /\\$[^$]+\\$/.test(text),
      };
    })()`);

    expect(structure.mainCount).toBe(1);
    expect(structure.detailsCount).toBeGreaterThanOrEqual(1);
    expect(structure.svgCount).toBeGreaterThanOrEqual(1);
    expect(structure.mathCount).toBeGreaterThanOrEqual(1);
    expect(structure.hasRawLatex).toBe(false);
  });

  it('T1-F11-03: native <dialog closedby="any"> Technical Guide modal opens via showModal and closes on Escape', async () => {
    await bootApp(page);
    const opened = await page.evaluate<{ isDialog: boolean; open: boolean; closedBy: string | null }>(`(() => {
      document.querySelector('#btnOpenGuide').click();
      const d = document.querySelector('#guideModal');
      return {
        isDialog: d instanceof HTMLDialogElement,
        open: Boolean(d && d.open),
        closedBy: d ? d.getAttribute('closedby') : null,
      };
    })()`);

    expect(opened.isDialog).toBe(true);
    expect(opened.open).toBe(true);
    expect(opened.closedBy).toBe('any');

    await page.pressKey('Escape', 'Escape', 27);
    await page.waitFor('!document.querySelector("#guideModal")?.open');
    const stillOpen = await page.evaluate<boolean>('Boolean(document.querySelector("#guideModal")?.open)');
    expect(stillOpen).toBe(false);
  });

  it('T1-F11-04: accessible focusgroup tablist supports ArrowRight, Home, and End keyboard navigation', async () => {
    await bootApp(page);
    await page.evaluate(`(() => {
      const firstTab = window.__e2eUi.getTabs()[0];
      firstTab.focus();
    })()`);

    const hasFocusgroup = await page.evaluate<boolean>(
      'Boolean(document.querySelector("[role=\\"tablist\\"][focusgroup], .tab-list[focusgroup]"))',
    );
    expect(hasFocusgroup).toBe(true);

    await page.pressKey('ArrowRight', 'ArrowRight', 39);
    await page.waitFor(
      'window.__e2eUi.getTabs().findIndex((t) => t.getAttribute("aria-selected") === "true" || t.classList.contains("active")) === 1',
    );
    const activeAfterRight = await page.evaluate<number>(
      'window.__e2eUi.getTabs().findIndex((t) => t.getAttribute("aria-selected") === "true" || t.classList.contains("active"))',
    );
    expect(activeAfterRight).toBe(1);

    await page.pressKey('End', 'End', 35);
    await page.waitFor(
      'window.__e2eUi.getTabs().findIndex((t) => t.getAttribute("aria-selected") === "true" || t.classList.contains("active")) === 3',
    );
    const activeAfterEnd = await page.evaluate<number>(
      'window.__e2eUi.getTabs().findIndex((t) => t.getAttribute("aria-selected") === "true" || t.classList.contains("active"))',
    );
    expect(activeAfterEnd).toBe(3);

    await page.pressKey('Home', 'Home', 36);
    await page.waitFor(
      'window.__e2eUi.getTabs().findIndex((t) => t.getAttribute("aria-selected") === "true" || t.classList.contains("active")) === 0',
    );
    const activeAfterHome = await page.evaluate<number>(
      'window.__e2eUi.getTabs().findIndex((t) => t.getAttribute("aria-selected") === "true" || t.classList.contains("active"))',
    );
    expect(activeAfterHome).toBe(0);
  });

  it('T1-F11-05: zero dynamic innerHTML or alert() in src/ TS files, and toast uses popover="manual"', async () => {
    assertDeliverableExists('src/app.ts', 'M4');
    const tsFiles = walkFiles(resolveWorkspacePath('src')).filter((f) => f.endsWith('.ts'));
    for (const rel of tsFiles) {
      const content = fs.readFileSync(resolveWorkspacePath('src', rel), 'utf8');
      expect(content.includes('.innerHTML'), `innerHTML found in src/${rel}`).toBe(false);
      expect(/\balert\s*\(/.test(content), `alert() found in src/${rel}`).toBe(false);
    }

    await bootApp(page);
    const hasManualPopover = await page.evaluate<boolean>(
      'Boolean(document.querySelector("[popover=\\"manual\\"]"))',
    );
    expect(hasManualPopover).toBe(true);
  });

  it('T1-F11-06: valid JSON config export and import updates UI inputs and calculated metrics', async () => {
    const presets = await loadPresetsContract();
    const schema = await loadSchemaContract();
    await bootApp(page);

    const sample = await page.evaluate<string>(`(() => {
      return document.querySelector('#inputBasePower').value;
    })()`);
    expect(Number(sample)).toBe(40);

    const exported = schema.exportJson(cloneDefaultInput(presets));
    const parsed = schema.validateAndParse(exported);
    expect(parsed.ok).toBe(true);

    // Trigger valid JSON import in browser via #fileImportInput
    await page.evaluate(`(() => {
      const inputEl = document.querySelector('#fileImportInput');
      const cfg = ${exported};
      cfg.basePower_W = 55;
      cfg.pulseWidthOverride_fs = 300;
      const file = new File([JSON.stringify(cfg)], 'cfg.json', { type: 'application/json' });
      const dt = new DataTransfer();
      dt.items.add(file);
      inputEl.files = dt.files;
      inputEl.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    await page.waitFor(
      'Number(document.querySelector("#inputBasePower")?.value) === 55 && (document.querySelector("#metricPulseEnergyOutput")?.textContent || "").includes("247.")',
    );
    const imported = await page.evaluate<{ power: string; pulseEnergyText: string }>(`({
      power: document.querySelector('#inputBasePower').value,
      pulseEnergyText: document.querySelector('#metricPulseEnergyOutput')?.textContent || '',
    })`);

    expect(Number(imported.power)).toBe(55);
    const energyMatch = imported.pulseEnergyText.match(/[-+]?\d+(?:\.\d+)?/);
    expect(energyMatch, `Expected numeric #metricPulseEnergyOutput, got "${imported.pulseEnergyText}"`).not.toBeNull();
    // 55 W / 200 kHz * 1000 * 90% = 247.5 uJ
    expectClose(Number(energyMatch![0]), 247.5, 1e-2, 'imported #metricPulseEnergyOutput');
  });

  it('T2-F11-01: strict JSON import rejects prototype pollution payloads cleanly', async () => {
    const schema = await loadSchemaContract();
    const res1 = schema.validateAndParse('{"__proto__": {"polluted": true}, "basePower_W": 40}');
    const res2 = schema.validateAndParse('{"constructor": {"prototype": {"polluted": true}}}');
    expect(res1.ok).toBe(false);
    expect(res2.ok).toBe(false);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('T2-F11-02: strict JSON import rejects malformed syntax and non-object JSON without uncaught errors', async () => {
    const schema = await loadSchemaContract();
    for (const payload of ['{bad json', '[1,2,3]', 'null', '42', '"hello"']) {
      const res = schema.validateAndParse(payload);
      expect(res.ok, `Expected rejection for ${payload}`).toBe(false);
    }
  });

  it('T2-F11-03: strict JSON import rejects unknown keys, invalid enums, and out-of-bounds numbers', async () => {
    const schema = await loadSchemaContract();
    const badPayloads = [
      '{"unknownKey": 1}',
      '{"laserId": "BAD_LASER"}',
      '{"basePower_W": -5}',
      '{"attenuator_pct": 150}',
    ];
    for (const payload of badPayloads) {
      const res = schema.validateAndParse(payload);
      expect(res.ok, `Expected rejection for ${payload}`).toBe(false);
    }
  });

  it('T2-F11-04: <dialog> light-dismiss fallback closes guide modal when closedBy is unsupported', async () => {
    await withCdpPage(async (freshPage) => {
      await freshPage.addScriptToEvaluateOnNewDocument(
        'try { delete HTMLDialogElement.prototype.closedBy; } catch {}',
      );
      await bootApp(freshPage);
      const res = await freshPage.evaluate<{ hasClosedByProp: boolean; closed: boolean }>(`(async () => {
        const d = document.querySelector('#guideModal');
        const hasClosedByProp = Boolean(d && ('closedBy' in d));
        document.querySelector('#btnOpenGuide').click();
        await new Promise((r) => setTimeout(r, 40));
        d.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 1, clientY: 1 }));
        await new Promise((r) => setTimeout(r, 60));
        return { hasClosedByProp, closed: Boolean(d && !d.open) };
      })()`);
      expect(res.hasClosedByProp).toBe(false);
      expect(res.closed).toBe(true);
    });
  });

  it('T2-F11-05: focusgroup polyfill updates tabindex and switches active tabpanel via keyboard', async () => {
    await bootApp(page);
    await page.evaluate('window.__e2eUi.getTabs()[0].focus()');
    await page.pressKey('ArrowRight', 'ArrowRight', 39);
    await page.waitFor(
      'window.__e2eUi.getTabs().findIndex((t) => t.getAttribute("aria-selected") === "true" || t.classList.contains("active")) === 1',
    );
    const tabState = await page.evaluate<{ selectedIdx: number; tabindex0: string | null; tabindex1: string | null }>(`(() => {
      const tabs = window.__e2eUi.getTabs();
      return {
        selectedIdx: tabs.findIndex((t) => t.getAttribute('aria-selected') === "true" || t.classList.contains('active')),
        tabindex0: tabs[0].getAttribute('tabindex'),
        tabindex1: tabs[1].getAttribute('tabindex'),
      };
    })()`);
    expect(tabState.selectedIdx).toBe(1);
    expect(tabState.tabindex1).toBe('0');
    expect(tabState.tabindex0).toBe('-1');
  });

  it('T2-F11-06: persisted theme applies synchronously before paint on reload (zero FOUC)', async () => {
    await withCdpPage(async (freshPage) => {
      await bootApp(freshPage, { clearStorage: true });
      const initialTheme = await freshPage.evaluate<string>(
        'document.documentElement.dataset.theme || ""',
      );
      const targetTheme = initialTheme === 'dark' ? 'light' : 'dark';
      await freshPage.evaluate('document.querySelector("#btnToggleTheme").click()');
      const savedTheme = await freshPage.evaluate<string>(
        'document.documentElement.dataset.theme || ""',
      );
      expect(savedTheme).toBe(targetTheme);

      await freshPage.addScriptToEvaluateOnNewDocument(`(() => {
        const trace = [];
        window.__e2eThemeTrace = trace;
        const record = (phase) => {
          trace.push({
            phase,
            theme: document.documentElement ? (document.documentElement.dataset.theme || '') : '',
            readyState: document.readyState,
            hasBody: Boolean(document.body),
          });
        };
        const obs = new MutationObserver(() => record('mutation'));
        obs.observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-theme'] });
        document.addEventListener('DOMContentLoaded', () => record('domcontentloaded'), { once: true });
      })()`);

      await freshPage.reload();
      await freshPage.waitFor('document.readyState === "complete"');
      const check = await freshPage.evaluate<{
        reloadedTheme: string;
        prePaintMatch: boolean;
        trace: Array<{ phase: string; theme: string; readyState: string; hasBody: boolean }>;
      }>(`(() => {
        const trace = window.__e2eThemeTrace || [];
        const prePaintMatch = trace.some(
          (entry) => entry.theme === '${targetTheme}' && entry.readyState === 'loading' && !entry.hasBody,
        );
        return {
          reloadedTheme: document.documentElement.dataset.theme || '',
          prePaintMatch,
          trace,
        };
      })()`);
      expect(check.reloadedTheme).toBe(targetTheme);
      expect(check.prePaintMatch, `Theme was not applied pre-paint: ${JSON.stringify(check.trace)}`).toBe(true);
    });
  });
});
