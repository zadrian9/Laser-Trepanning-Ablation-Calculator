import fs from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { CdpSession, withCdpPage } from './helpers/cdp.ts';
import {
  cloneDefaultInput,
  closeViteSsrServer,
  findLaserByName,
  findScanheadByName,
  loadPresetsContract,
  loadSchemaContract,
  loadTsEngineContract,
  loadWasmRunnerContract,
  startViteWorkerHarnessServer,
} from './helpers/contracts.ts';
import {
  assertDeliverableExists,
  type DistSubpathServer,
  expectClose,
  GOLDEN_DEFAULT,
  parsePngInfo,
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

const WORKFLOW_HELPERS = `(() => {
  if (window.__e2eWf) return true;
  window.__e2eWf = {
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
      return Array.from(document.querySelectorAll('canvas')).find((c) => c.offsetWidth > 0 && c.offsetHeight > 0) || null;
    },
    getActiveTable() {
      const panelTables = Array.from(
        document.querySelectorAll('[role="tabpanel"]:not([hidden]) table, .canvas-tab-panel.active table'),
      );
      const visiblePanelTable = panelTables.find((t) => this.isVisible(t));
      if (visiblePanelTable) return visiblePanelTable;
      return Array.from(document.querySelectorAll('table')).find((t) => this.isVisible(t)) || null;
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
      const distinct = new Set();
      for (let i = 0; i < data.length; i += 4) {
        hash ^= data[i]; hash = Math.imul(hash, 16777619);
        hash ^= data[i + 1]; hash = Math.imul(hash, 16777619);
        hash ^= data[i + 2]; hash = Math.imul(hash, 16777619);
        if (distinct.size < 20) distinct.add((data[i] >> 4) + ',' + (data[i + 1] >> 4) + ',' + (data[i + 2] >> 4));
      }
      return { width: canvas.width, height: canvas.height, hash: hash >>> 0, distinctColors: distinct.size };
    },
    setInput(selectorOrLabel, value) {
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
    selectOptionByText(selectSelector, textMatch) {
      const sel = document.querySelector(selectSelector);
      if (!sel) throw new Error('Select not found: ' + selectSelector);
      const rx = new RegExp(textMatch, 'i');
      const opt = Array.from(sel.options).find((o) => rx.test(o.text) || rx.test(o.value));
      if (!opt) throw new Error('Option not found: ' + textMatch);
      sel.value = opt.value;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      return opt.value;
    },
    clickControl(regexStr, rootSelector) {
      const rx = new RegExp(regexStr, 'i');
      const roots = rootSelector ? Array.from(document.querySelectorAll(rootSelector)) : [document];
      if (roots.length === 0) return false;
      const seen = new Set();
      for (const root of roots) {
        for (const el of root.querySelectorAll('button, label, input[type="checkbox"], input[type="radio"], summary')) {
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
    dismissAllToasts() {
      const pop = document.querySelector('#toastRegion, [popover="manual"]');
      if (!pop) return 0;
      const btns = Array.from(pop.querySelectorAll('.toast-close-btn, button'));
      for (const b of btns) b.click();
      return btns.length;
    },
    parseMetricNumber(selector) {
      const txt = document.querySelector(selector)?.textContent || '';
      const m = txt.match(/[-+]?\\d+(?:\\.\\d+)?/);
      return m ? Number(m[0]) : NaN;
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

async function bootM4App(page: CdpSession, clearStorage = false): Promise<void> {
  const srv = await ensureDistServer();
  page.clearLogs();
  await page.navigate(srv.baseUrl);
  if (clearStorage) {
    await page.evaluate('localStorage.clear()');
    await page.reload();
  }
  await page.waitFor('document.readyState === "complete"');

  const ready = await page.evaluate<{ tabs: number; canvases: number; hasDialog: boolean }>(`({
    tabs: document.querySelectorAll('[role="tab"], .tab-btn').length,
    canvases: document.querySelectorAll('canvas').length,
    hasDialog: Boolean(document.querySelector('dialog')),
  })`);
  if (page.failedRequests.some((r) => r.url.endsWith('style.css') && r.status === 404)) {
    throw new Error('Waiting for M4: dist/index.html missing bundled style.css (404)');
  }
  if (ready.tabs < 4 || ready.canvases < 4 || !ready.hasDialog) {
    throw new Error(
      `Waiting for M3/M4: dist/ app missing 4 tabs/canvases or <dialog> (tabs=${ready.tabs}, canvases=${ready.canvases})`,
    );
  }

  await page.evaluate(WORKFLOW_HELPERS);
  await page.waitFor(
    '(() => { const b = document.querySelector("#badgeEngineBackend")?.textContent || ""; const s = document.querySelector("#metricSpotSize")?.textContent || ""; return b.length > 0 && !/Initializing/i.test(b) && s.trim().length > 0 && s.trim() !== "--"; })()',
    10000,
    40,
  );
  await waitRaf(page, 2);
}

describe('Tier 3 — Cross-Feature Pairwise Combinations (T3-01..T3-15)', () => {
  it('T3-01 (F1 x F2): every built js/css/wasm/png/svg/webmanifest asset in dist/ is covered by dist/sw.js precache', () => {
    const distDir = assertDeliverableExists('dist', 'M1');
    const swText = fs.readFileSync(assertDeliverableExists('dist/sw.js', 'M1'), 'utf8');
    const files = walkFiles(distDir);

    const forbidden = files.filter((f) =>
      /(CNAME|\.xlsx$|inspect_.*\.py$|dump_specs\.py$|test_math\.py$|main_cells\.txt$|defined_names\.json$|sheet_.*\.json$)/i.test(
        f,
      ),
    );
    expect(forbidden).toEqual([]);

    const precacheCandidates = files.filter(
      (f) =>
        /\.(js|css|html|wasm|svg|png|webmanifest)$/i.test(f) &&
        !f.startsWith('sw.js') &&
        !f.startsWith('workbox-'),
    );
    const hasCss = precacheCandidates.some((f) => f.endsWith('.css'));
    const hasWasm = precacheCandidates.some((f) => f.endsWith('.wasm'));
    if (!hasWasm || !hasCss) {
      throw new Error(`Waiting for M2/M4: dist/ missing compiled .wasm (${hasWasm}) or bundled .css (${hasCss})`);
    }
    for (const file of precacheCandidates) {
      expect(swText, `dist/sw.js precache missing ${file}`).toContain(file);
    }
  });

  it('T3-02 (F3 x F4): Arges + Charmilles Green + Square Hole triggers both warnings and Arges kinematics', async () => {
    const presets = await loadPresetsContract();
    const compute = await loadTsEngineContract();
    const input = cloneDefaultInput(presets);
    input.laserId = findLaserByName(presets, 'Charmilles Femto FlexiPulse Green').id;
    input.scanheadId = findScanheadByName(presets, 'Arges Elephant v2 IR').id;
    input.holeType = 'square';
    input.pulseWidthOverride_fs = null;

    const out = compute(input);
    expect(out.scalars.wavelengthMismatch).toBe(true);
    expect(out.scalars.argesSquareWarning).toBe(true);
    expectClose(out.scalars.effectiveScanRadius_um, input.endDia_um, 1e-6);
    expectClose(out.scalars.zShift_um, (input.endZ / 100) * 1050, 1e-6);
  });

  it('T3-03 (F3 x F6): Scanhead brand kinematics flow accurately into 8 Z-planes and 2-plane Exit Aperture MaxR', async () => {
    const presets = await loadPresetsContract();
    const compute = await loadTsEngineContract();

    const slOut = compute(cloneDefaultInput(presets));
    const argesIn = cloneDefaultInput(presets);
    argesIn.scanheadId = findScanheadByName(presets, 'Arges Elephant v2 IR').id;
    argesIn.endAOI = -70; // -70% of 10 deg = -7 deg
    argesIn.endZ = 100; // 100% of 1050 um
    const argesOut = compute(argesIn);

    expect(slOut.scalars.exitAperture1MaxR_um).not.toBe(argesOut.scalars.exitAperture1MaxR_um);
    expectClose(argesOut.scalars.zShift_um, 1050, 1e-6);
    expect(Number.isFinite(argesOut.scalars.exitAperture1MaxR_um)).toBe(true);
    expect(Number.isFinite(argesOut.scalars.exitAperture2MaxR_um)).toBe(true);
  });

  it('T3-04 (F4 x F5): Attenuator & AblationThresh overrides propagate into focusDist and isofluence curves', async () => {
    const presets = await loadPresetsContract();
    const compute = await loadTsEngineContract();
    const baseOut = compute(cloneDefaultInput(presets));

    const modIn = cloneDefaultInput(presets);
    modIn.attenuator_pct = 50;
    modIn.ablationThreshOverride_J_cm2 = 5;
    const modOut = compute(modIn);

    expectClose(modOut.scalars.peakFluence_J_cm2, baseOut.scalars.peakFluence_J_cm2 / 2, 1e-6);
    expectClose(modOut.scalars.thresholdRatio, 5 / modOut.scalars.peakFluence_J_cm2, 1e-6);

    const countPositiveAbl = (fd: Float64Array) => {
      let c = 0;
      for (let i = 0; i < 601; i++) if (fd[i * 5 + 4] > 0) c++;
      return c;
    };
    expect(countPositiveAbl(modOut.focusDist)).toBeLessThan(countPositiveAbl(baseOut.focusDist));

    const countFiniteIsoAbl = (iso: Float64Array) => {
      let c = 0;
      for (let i = 0; i < 1001; i++) if (Number.isFinite(iso[i * 22 + 9])) c++;
      return c;
    };
    expect(countFiniteIsoAbl(modOut.isofluence)).toBeLessThan(countFiniteIsoAbl(baseOut.isofluence));
  });

  it('T3-05 (F4 x F10): Z From Focus input syncs physics lookup with Tab 3 Isofluence live marker', async () => {
    const presets = await loadPresetsContract();
    const compute = await loadTsEngineContract();
    const inp = cloneDefaultInput(presets);
    inp.zFromFocusLookup_um = 250;
    const out = compute(inp);
    expect(out.scalars.ablatedSpotAtLookupZ_um).toBeGreaterThan(20);

    await withCdpPage(async (page) => {
      await bootM4App(page);
      await page.evaluate('window.__e2eWf.selectTab("isofluence|chart 1")');
      await waitRaf(page, 2);
      const before = await page.evaluate<number>(
        'window.__e2eWf.getCanvasHash(window.__e2eWf.getVisibleCanvas()).hash',
      );
      await page.evaluate('window.__e2eWf.setInput("Z From Focus", 250)');
      await page.waitFor(
        `window.__e2eWf.getCanvasHash(window.__e2eWf.getVisibleCanvas()).hash !== ${before}`,
      );
      const after = await page.evaluate<number>(
        'window.__e2eWf.getCanvasHash(window.__e2eWf.getVisibleCanvas()).hash',
      );
      expect(after).not.toBe(before);
    });
  });

  it('T3-06 (F5 x F6): Isofluence NaN cutoffs propagate cleanly into TrepanningCalcs cross-section curves', async () => {
    const presets = await loadPresetsContract();
    const compute = await loadTsEngineContract();
    const inp = cloneDefaultInput(presets);
    inp.ablationThreshOverride_J_cm2 = 50; // high threshold cuts off early
    const out = compute(inp);

    // Column 4 (FWD_TOP_RIGHT_W) remains finite at k=1000 while Column 0 (FWD_TOP_RIGHT_ABL) becomes NaN
    expect(Number.isFinite(out.trepanningProfile[1000 * 16 + 4 * 2])).toBe(true);
    expect(Number.isNaN(out.trepanningProfile[1000 * 16 + 0 * 2])).toBe(true);
    expect(Number.isFinite(out.trepanningProfile[0])).toBe(true);
  });

  it('T3-07 (F6 x F7): 101-state Transition Sweep computed in WASM Worker matches TS fallback identically', async () => {
    const presets = await loadPresetsContract();
    const tsCompute = await loadTsEngineContract();
    const harness = await startViteWorkerHarnessServer();

    const inp = cloneDefaultInput(presets);
    inp.stateMode = 'transition';
    inp.startDia_um = 100;
    inp.startAOI = -2;
    inp.startZ = -400;
    inp.endDia_um = 500;
    inp.endAOI = -7.5;
    inp.endZ = -1100;

    const tsOut = tsCompute(inp);
    try {
      await withCdpPage(async (page) => {
        await page.navigate(harness.url);
        await page.waitFor('window.__e2eReady === true');
        const workerSweep = await page.evaluate<{ backend: string; sweep: number[] }>(`(async () => {
          const res = await window.__e2eWorker.compute(${JSON.stringify(inp)});
          const output = res.output || res;
          return { backend: res.backend, sweep: Array.from(output.transitionSweep) };
        })()`);

        expect(workerSweep.backend).toBe('wasm');
        expect(workerSweep.sweep.length).toBe(303);
        for (let i = 0; i < 303; i++) {
          expectClose(workerSweep.sweep[i], tsOut.transitionSweep[i], 1e-10, `sweep[${i}]`);
        }
      });
    } finally {
      await harness.close();
    }
  });

  it('T3-08 (F6 x F9): Transition scrubber updates Safety Heatmap, badges, Tab 1, and Tab 2 simultaneously', async () => {
    await withCdpPage(async (page) => {
      await bootM4App(page);
      await page.evaluate(`(() => {
        window.__e2eWf.clickControl('#radioTransitionState|Transition');
        window.__e2eWf.setInput('#inputStartDia', 100);
        window.__e2eWf.setInput('#inputStartAOI', -2);
        window.__e2eWf.setInput('#inputEndDia', 450);
        window.__e2eWf.setInput('#inputEndAOI', -7.5);
        window.__e2eWf.setInput('#sliderProgress', 0);
      })()`);
      await page.waitFor(
        '(() => { const n = document.querySelector("#badgeNozzleClearance")?.textContent || ""; const w = document.querySelector("#badgeWallClearance")?.textContent || ""; const r = document.querySelector("#readoutCurrentRadius")?.textContent || ""; return n.includes("OK") && w.includes("Within Limit") && r.includes("50"); })()',
        10000,
        40,
      );
      await waitRaf(page, 2);
      const tab1_0 = await page.evaluate<number>(
        'window.__e2eWf.getCanvasHash(window.__e2eWf.getVisibleCanvas()).hash',
      );
      const nozzle0 = await page.evaluate<string>(
        'document.querySelector("#badgeNozzleClearance")?.textContent || ""',
      );
      const wall0 = await page.evaluate<string>(
        'document.querySelector("#badgeWallClearance")?.textContent || ""',
      );
      await page.evaluate('window.__e2eWf.selectTab("topdown|multi|3d")');
      await page.waitFor(
        '(() => { const s = document.querySelector("[data-safety-heatmap], .safety-heatmap, canvas[id*=\\"heatmap\\" i], [id*=\\"heatmap\\" i]"); if (!(s instanceof HTMLCanvasElement)) return Boolean(s); const st = window.__e2eWf.getCanvasHash(s); return Boolean(st && st.distinctColors >= 2); })()',
        10000,
        40,
      );
      await waitRaf(page, 2);
      const heatmapOk = await page.evaluate<boolean>(`(() => {
        const strip = document.querySelector('[data-safety-heatmap], .safety-heatmap, canvas[id*="heatmap" i], [id*="heatmap" i]');
        if (!strip) return false;
        if (strip instanceof HTMLCanvasElement) {
          const stats = window.__e2eWf.getCanvasHash(strip);
          return Boolean(stats && stats.distinctColors >= 2);
        }
        return strip.childElementCount > 0 || (strip.textContent || '').trim().length > 0 || strip.getBoundingClientRect().width > 0;
      })()`);
      expect(heatmapOk, 'Missing or empty Safety Heatmap strip').toBe(true);
      const tab2_0 = await page.evaluate<number>(
        'window.__e2eWf.getCanvasHash(window.__e2eWf.getVisibleCanvas()).hash',
      );

      await page.evaluate('window.__e2eWf.setInput("#sliderProgress", 100)');
      await page.waitFor(
        `(() => { const n = document.querySelector("#badgeNozzleClearance")?.textContent || ""; const w = document.querySelector("#badgeWallClearance")?.textContent || ""; const h = window.__e2eWf.getCanvasHash(window.__e2eWf.getVisibleCanvas())?.hash; return n !== ${JSON.stringify(nozzle0)} && w !== ${JSON.stringify(wall0)} && h !== ${tab2_0}; })()`,
        10000,
        40,
      );
      await waitRaf(page, 2);
      const tab2_100 = await page.evaluate<number>(
        'window.__e2eWf.getCanvasHash(window.__e2eWf.getVisibleCanvas()).hash',
      );
      const nozzle100 = await page.evaluate<string>(
        'document.querySelector("#badgeNozzleClearance")?.textContent || ""',
      );
      const wall100 = await page.evaluate<string>(
        'document.querySelector("#badgeWallClearance")?.textContent || ""',
      );
      await page.evaluate('window.__e2eWf.selectTab("profile|cross")');
      await waitRaf(page, 2);
      const tab1_100 = await page.evaluate<number>(
        'window.__e2eWf.getCanvasHash(window.__e2eWf.getVisibleCanvas()).hash',
      );

      expect(tab1_100).not.toBe(tab1_0);
      expect(tab2_100).not.toBe(tab2_0);
      expect(nozzle100).not.toBe(nozzle0);
      expect(wall100).not.toBe(wall0);
    });
  });

  it('T3-09 (F7 x F8): rapid Worker updates combined with window resize render cleanly with zero console errors', async () => {
    await withCdpPage(async (page) => {
      await bootM4App(page);
      await page.evaluate('window.__e2eWf.clickControl("#radioTransitionState|Transition")');
      for (const p of [10, 30, 50, 70, 90]) {
        await page.evaluate(`window.__e2eWf.setInput('#sliderProgress', ${p})`);
      }
      await page.setViewport(1024, 720, 1);
      await page.waitFor(
        '(document.querySelector("#textProgress")?.textContent || "").includes("90") && document.documentElement.clientWidth <= 1026',
      );
      await waitRaf(page, 2);
      const stats = await page.evaluate<{ width: number; distinctColors: number }>(
        'window.__e2eWf.getCanvasHash(window.__e2eWf.getVisibleCanvas())',
      );
      expect(stats.width).toBeGreaterThan(100);
      expect(stats.distinctColors).toBeGreaterThan(2);
      expect(page.consoleErrors).toEqual([]);
      expect(page.pageErrors).toEqual([]);
    });
  });

  it('T3-10 (F8 x F9): Pointer pan/zoom + Graph Limit Expansion + PNG export + Reset View work together on Tab 1', async () => {
    await withCdpPage(async (page) => {
      await bootM4App(page);
      await page.evaluate(`(() => {
        window.__e2eWf.setInput('Z Min', -800);
        window.__e2eWf.setInput('Z Max', 2200);
      })()`);
      await waitRaf(page, 2);
      const baseHash = await page.evaluate<number>(
        'window.__e2eWf.getCanvasHash(window.__e2eWf.getVisibleCanvas()).hash',
      );

      const rect = await page.evaluate<{ x: number; y: number; w: number; h: number }>(
        '(() => { const r = window.__e2eWf.getVisibleCanvas().getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; })()',
      );
      const cx = rect.x + rect.w / 2;
      const cy = rect.y + rect.h / 2;
      await page.mouseDrag(cx, cy, cx + 60, cy + 40);
      await page.waitFor(
        `window.__e2eWf.getCanvasHash(window.__e2eWf.getVisibleCanvas()).hash !== ${baseHash}`,
      );
      const pannedHash = await page.evaluate<number>(
        'window.__e2eWf.getCanvasHash(window.__e2eWf.getVisibleCanvas()).hash',
      );
      expect(pannedHash).not.toBe(baseHash);

      await page.wheel(cx, cy, -250);
      await page.waitFor(
        `window.__e2eWf.getCanvasHash(window.__e2eWf.getVisibleCanvas()).hash !== ${pannedHash}`,
      );
      const zoomedHash = await page.evaluate<number>(
        'window.__e2eWf.getCanvasHash(window.__e2eWf.getVisibleCanvas()).hash',
      );
      expect(zoomedHash).not.toBe(pannedHash);

      const pngExport = await page.evaluate<{ clicked: boolean; pngOk: boolean }>(`(async () => {
        const blobs = [];
        const links = [];
        const origCreate = URL.createObjectURL.bind(URL);
        const origClick = HTMLAnchorElement.prototype.click;
        URL.createObjectURL = (obj) => { if (obj instanceof Blob) blobs.push(obj); return origCreate(obj); };
        HTMLAnchorElement.prototype.click = function () { links.push({ dl: this.download || '', href: this.href || '' }); };
        let clicked = false;
        try {
          clicked = window.__e2eWf.clickControl(
            'Export PNG|PNG',
            '[role="tabpanel"]:not([hidden]), .canvas-tab-panel.active, .canvas-actions, .canvas-header',
          );
          const deadline = Date.now() + 2000;
          while (Date.now() < deadline && blobs.length === 0 && links.length === 0) {
            await new Promise((r) => setTimeout(r, 20));
          }
        } finally {
          URL.createObjectURL = origCreate;
          HTMLAnchorElement.prototype.click = origClick;
        }
        let pngOk = false;
        const blob = blobs.find((b) => b.type === 'image/png') || blobs[0];
        if (blob) {
          const buf = new Uint8Array(await blob.arrayBuffer());
          pngOk = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
        } else {
          const link = links.find((l) => l.href.startsWith('data:image/png'));
          pngOk = Boolean(link);
        }
        return { clicked, pngOk };
      })()`);
      expect(pngExport.clicked).toBe(true);
      expect(pngExport.pngOk).toBe(true);

      await page.evaluate('window.__e2eWf.clickControl("Reset View")');
      await page.mouseMove(2, 2);
      await page.waitFor(
        `window.__e2eWf.getCanvasHash(window.__e2eWf.getVisibleCanvas()).hash === ${baseHash}`,
      ).catch(() => undefined);
      await waitRaf(page, 2);
      const resetHash = await page.evaluate<number>(
        'window.__e2eWf.getCanvasHash(window.__e2eWf.getVisibleCanvas()).hash',
      );
      expect(resetHash).toBe(baseHash);
    });
  });

  it('T3-11 (F8 x F10): Hover crosshair and Numeric Table stay synchronized across Normalized vs J/cm2 toggle on Tab 4', async () => {
    await withCdpPage(async (page) => {
      await bootM4App(page);
      await page.evaluate('window.__e2eWf.selectTab("fluence|distribution|chart 6")');
      await waitRaf(page, 2);
      const rect = await page.evaluate<{ x: number; y: number; w: number; h: number }>(
        '(() => { const r = window.__e2eWf.getVisibleCanvas().getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; })()',
      );
      await page.mouseMove(rect.x + rect.w * 0.45, rect.y + rect.h * 0.5);
      await page.waitFor(
        '/[-+]?\\d+/.test((document.querySelector("[data-crosshair-readout], .crosshair-readout, #canvasCrosshair, [id*=\\"crosshair\\" i], [class*=\\"crosshair\\" i]")?.textContent || "").trim())',
      );
      const normCrosshair = await page.evaluate<string>(
        '(document.querySelector("[data-crosshair-readout], .crosshair-readout, #canvasCrosshair, [id*=\\"crosshair\\" i], [class*=\\"crosshair\\" i]")?.textContent || "").trim()',
      );
      expect(normCrosshair).toMatch(/[-+]?\d+/);

      await page.evaluate('window.__e2eWf.clickControl("Table|Numeric", "[role=\\"tabpanel\\"]:not([hidden]), .canvas-tab-panel.active, .canvas-actions, .canvas-header")');
      const normTable = await page.evaluate<string>(
        'window.__e2eWf.getActiveTable()?.textContent || ""',
      );

      await page.evaluate(`(() => {
        const sel = document.querySelector('#panelFluence select, #selectFluenceUnit');
        if (sel) {
          window.__e2eWf.selectOptionByText('#panelFluence select, #selectFluenceUnit', 'J/cm|Fluence');
        } else {
          window.__e2eWf.clickControl('J/cm|Fluence|Unit', '#panelFluence, [role="tabpanel"]:not([hidden]), .canvas-actions');
        }
      })()`);
      await page.waitFor(
        '(window.__e2eWf.getActiveTable()?.textContent || "").includes("190.")',
      );
      await waitRaf(page, 2);
      await page.mouseMove(rect.x + rect.w * 0.45, rect.y + rect.h * 0.5);
      await page.waitFor(
        `(document.querySelector("[data-crosshair-readout], .crosshair-readout, #canvasCrosshair, [id*=\\"crosshair\\" i], [class*=\\"crosshair\\" i]")?.textContent || "").trim() !== ${JSON.stringify(normCrosshair)}`,
      );
      const jcmCrosshair = await page.evaluate<string>(
        '(document.querySelector("[data-crosshair-readout], .crosshair-readout, #canvasCrosshair, [id*=\\"crosshair\\" i], [class*=\\"crosshair\\" i]")?.textContent || "").trim()',
      );
      const jcmTable = await page.evaluate<string>(
        'window.__e2eWf.getActiveTable()?.textContent || ""',
      );
      expect(jcmCrosshair).toMatch(/[-+]?\d+/);
      expect(jcmCrosshair).not.toBe(normCrosshair);
      expect(jcmTable).not.toBe(normTable);
      expect(jcmTable).toContain('190.');
    });
  });

  it('T3-12 (F9 x F11): NozzleApertureDia=1.5 mm and EntranceDia=400 um update badges, Tab 1, and Tab 2', async () => {
    await withCdpPage(async (page) => {
      await bootM4App(page);
      const beforeBadge = await page.evaluate<string>(
        'document.querySelector("#badgeNozzleClearance")?.textContent || ""',
      );
      const beforeTab1 = await page.evaluate<number>(
        'window.__e2eWf.getCanvasHash(window.__e2eWf.getVisibleCanvas()).hash',
      );
      await page.evaluate('window.__e2eWf.selectTab("topdown|multi|3d")');
      await waitRaf(page, 2);
      const beforeTab2 = await page.evaluate<number>(
        'window.__e2eWf.getCanvasHash(window.__e2eWf.getVisibleCanvas()).hash',
      );

      await page.evaluate(`(() => {
        window.__e2eWf.setInput('#overrideNozzleDia', 1.5);
        window.__e2eWf.setInput('#inputEntranceDia', 400);
      })()`);
      await page.waitFor(
        `(() => { const b = document.querySelector("#badgeNozzleClearance")?.textContent || ""; const h = window.__e2eWf.getCanvasHash(window.__e2eWf.getVisibleCanvas())?.hash; return b !== ${JSON.stringify(beforeBadge)} && h !== ${beforeTab2}; })()`,
      );
      await waitRaf(page, 2);

      const afterTab2 = await page.evaluate<number>(
        'window.__e2eWf.getCanvasHash(window.__e2eWf.getVisibleCanvas()).hash',
      );
      await page.evaluate('window.__e2eWf.selectTab("profile|cross")');
      await waitRaf(page, 2);
      const afterTab1 = await page.evaluate<number>(
        'window.__e2eWf.getCanvasHash(window.__e2eWf.getVisibleCanvas()).hash',
      );
      const afterBadge = await page.evaluate<string>(
        'document.querySelector("#badgeNozzleClearance")?.textContent || ""',
      );
      expect(afterBadge).not.toBe(beforeBadge);
      expect(afterTab1).not.toBe(beforeTab1);
      expect(afterTab2).not.toBe(beforeTab2);
    });
  });

  it('T3-13 (F10 x F11): Light/Dark theme toggle updates Tab 3 & Tab 4 canvas palettes immediately', async () => {
    await withCdpPage(async (page) => {
      await bootM4App(page, true);
      await page.evaluate('window.__e2eWf.selectTab("isofluence|chart 1")');
      await waitRaf(page, 2);
      const tab3Before = await page.evaluate<number>(
        'window.__e2eWf.getCanvasHash(window.__e2eWf.getVisibleCanvas()).hash',
      );

      await page.evaluate('window.__e2eWf.selectTab("fluence|energy|distribution|chart 6")');
      await waitRaf(page, 2);
      const tab4Before = await page.evaluate<number>(
        'window.__e2eWf.getCanvasHash(window.__e2eWf.getVisibleCanvas()).hash',
      );

      await page.evaluate('document.querySelector("#btnToggleTheme").click()');
      await page.waitFor(
        `window.__e2eWf.getCanvasHash(window.__e2eWf.getVisibleCanvas()).hash !== ${tab4Before}`,
      );
      const tab4After = await page.evaluate<number>(
        'window.__e2eWf.getCanvasHash(window.__e2eWf.getVisibleCanvas()).hash',
      );
      expect(tab4After).not.toBe(tab4Before);

      await page.evaluate('window.__e2eWf.selectTab("isofluence|chart 1")');
      await waitRaf(page, 2);
      const tab3After = await page.evaluate<number>(
        'window.__e2eWf.getCanvasHash(window.__e2eWf.getVisibleCanvas()).hash',
      );
      expect(tab3After).not.toBe(tab3Before);
    });
  });

  it('T3-14 (F4 x F11): Beam Divergence toggle updates metrics grid and Technical Guide MathML/SVG dialog', async () => {
    await withCdpPage(async (page) => {
      await bootM4App(page);
      const currDiv = await page.evaluate<number>('window.__e2eWf.parseMetricNumber("#metricBeamDivergence")');
      expectClose(currDiv, 42.42, 1e-2, 'current divergence UI');

      const switched = await page.evaluate<boolean>(`(() => {
        const sel = document.querySelector('#selectDivergence, select[id*="Divergence" i], select[aria-label*="Divergence" i]');
        if (sel) {
          const opt = Array.from(sel.options).find((o) => /legacy/i.test(o.text + o.value));
          if (opt) { sel.value = opt.value; sel.dispatchEvent(new Event('change', { bubbles: true })); return true; }
        }
        return window.__e2eWf.clickControl('Legacy');
      })()`);
      expect(switched, 'Missing Beam Divergence toggle in UI').toBe(true);
      await page.waitFor(
        'Math.abs(window.__e2eWf.parseMetricNumber("#metricBeamDivergence") - 4.24) < 0.05',
      );

      const legDiv = await page.evaluate<number>('window.__e2eWf.parseMetricNumber("#metricBeamDivergence")');
      expectClose(legDiv, 4.24, 1e-2, 'legacy divergence UI');

      await page.evaluate('document.querySelector("#btnOpenGuide").click()');
      const modalCheck = await page.evaluate<{ open: boolean; math: number; svg: number }>(`({
        open: Boolean(document.querySelector('#guideModal')?.open),
        math: document.querySelectorAll('#guideModal math').length,
        svg: document.querySelectorAll('#guideModal svg').length,
      })`);
      expect(modalCheck.open).toBe(true);
      expect(modalCheck.math).toBeGreaterThanOrEqual(1);
      expect(modalCheck.svg).toBeGreaterThanOrEqual(1);
    });
  });

  it('T3-15 (F2 x F11): PWA SW lifecycle & toast popover="manual" operate with zero alert() or errors', async () => {
    await withCdpPage(async (page) => {
      await bootM4App(page);
      const setup = await page.evaluate<{ swReady: boolean; hasManualPopover: boolean }>(`(async () => {
        window.__e2eAlertCalls = 0;
        window.alert = () => { window.__e2eAlertCalls++; };

        const swReady = await (async () => {
          if (!('serviceWorker' in navigator)) return false;
          const reg = await Promise.race([
            navigator.serviceWorker.ready,
            new Promise((r) => setTimeout(() => r(null), 6000)),
          ]);
          return Boolean(reg && reg.active);
        })();

        // Allow any initial Workbox offline-ready toast to settle, then clear pre-existing toasts
        await new Promise((r) => setTimeout(r, 80));
        window.__e2eWf.dismissAllToasts();

        const pop = document.querySelector('[popover="manual"]');
        return { swReady, hasManualPopover: Boolean(pop) };
      })()`);

      await page.waitFor(
        '!document.querySelector("[popover=\\"manual\\"]")?.matches(":popover-open")',
      );

      await page.evaluate(`(() => {
        const inputEl = document.querySelector('#fileImportInput');
        if (inputEl) {
          const file = new File(['{invalid json'], 'bad.json', { type: 'application/json' });
          const dt = new DataTransfer();
          dt.items.add(file);
          inputEl.files = dt.files;
          inputEl.dispatchEvent(new Event('change', { bubbles: true }));
        }
      })()`);

      await page.waitFor(
        '(() => { const pop = document.querySelector("[popover=\\"manual\\"]"); return Boolean(pop && pop.matches(":popover-open") && /Invalid Configuration File/i.test(pop.textContent || "")); })()',
      );

      const dismissResult = await page.evaluate<{
        opened: boolean;
        hasErrorText: boolean;
        dismissed: boolean;
        alertCalls: number;
      }>(`(async () => {
        const pop = document.querySelector('[popover="manual"]');
        const opened = Boolean(pop && pop.matches(':popover-open'));
        const hasErrorText = Boolean(pop && /Invalid Configuration File/i.test(pop.textContent || ''));
        if (pop && opened) {
          const btns = Array.from(pop.querySelectorAll('.toast-close-btn, button'));
          if (btns.length > 0) {
            for (const btn of btns) btn.click();
          } else if (typeof pop.hidePopover === 'function') {
            pop.hidePopover();
          }
        }
        return {
          opened,
          hasErrorText,
          dismissed: Boolean(pop && !pop.matches(':popover-open')),
          alertCalls: window.__e2eAlertCalls || 0,
        };
      })()`);

      expect(setup.swReady).toBe(true);
      expect(setup.hasManualPopover).toBe(true);
      expect(dismissResult.opened).toBe(true);
      expect(dismissResult.hasErrorText).toBe(true);
      expect(dismissResult.dismissed).toBe(true);
      expect(dismissResult.alertCalls).toBe(0);
      expect(page.consoleErrors).toEqual([]);
      expect(page.pageErrors).toEqual([]);
    });
  });
});

describe('Tier 4 — Real-World Application Workflows (T4-01..T4-06)', () => {
  it('T4-01: Default Excel Golden Verification across WASM, TS fallback, Worker, UI metrics, and 4 canvases', async () => {
    const presets = await loadPresetsContract();
    const tsCompute = await loadTsEngineContract();
    const wasm = await loadWasmRunnerContract();
    const defaultIn = cloneDefaultInput(presets);

    const assertAll18Golden = (s: ReturnType<typeof tsCompute>['scalars'], prefix: string) => {
      expectClose(s.pulseEnergyBase_uJ, GOLDEN_DEFAULT.pulseEnergyBase_uJ, 1e-5, `${prefix} PulseEnergyBase`);
      expectClose(s.pulseEnergyOutput_uJ, GOLDEN_DEFAULT.pulseEnergyOutput_uJ, 1e-5, `${prefix} PulseEnergyOutput`);
      expectClose(s.avgPower_W, GOLDEN_DEFAULT.avgPower_W, 1e-5, `${prefix} AvgPower`);
      expectClose(s.peakPower_MW, GOLDEN_DEFAULT.peakPower_MW, 1e-5, `${prefix} PeakPower`);
      expectClose(s.spotSize_um, GOLDEN_DEFAULT.spotSize_um, 1e-5, `${prefix} SpotSize`);
      expectClose(s.rayleighRange_um, GOLDEN_DEFAULT.rayleighRange_um, 1e-5, `${prefix} RayleighRange`);
      expectClose(s.peakFluence_J_cm2, GOLDEN_DEFAULT.peakFluence_J_cm2, 1e-5, `${prefix} PeakFluence`);
      expectClose(s.peakIrradiance_TW_cm2, GOLDEN_DEFAULT.peakIrradiance_TW_cm2, 1e-5, `${prefix} PeakIrradiance`);
      expectClose(s.avgIrradiance_MW_cm2, GOLDEN_DEFAULT.avgIrradiance_MW_cm2, 1e-5, `${prefix} AvgIrradiance`);
      expectClose(s.scanSpeed_mm_s, GOLDEN_DEFAULT.scanSpeed_mm_s, 1e-5, `${prefix} ScanSpeed`);
      expectClose(s.spotOverlap_pct, GOLDEN_DEFAULT.spotOverlap_pct, 1e-4, `${prefix} SpotOverlap`);
      expectClose(s.ablatedSpotAt0_um, GOLDEN_DEFAULT.ablatedSpotAt0_um, 1e-5, `${prefix} AblatedSpot@0`);
      expectClose(s.thresholdR, GOLDEN_DEFAULT.thresholdR, 1e-5, `${prefix} ThresholdR`);
      expectClose(s.energyAboveThresh_pct, GOLDEN_DEFAULT.energyAboveThresh_pct, 1e-4, `${prefix} EnergyAboveThresh`);
      expectClose(s.exitAperture1MaxR_um, GOLDEN_DEFAULT.exitAperture1MaxR_um, 1e-5, `${prefix} ExitAperture1MaxR`);
      expectClose(s.exitAperture2MaxR_um, GOLDEN_DEFAULT.exitAperture2MaxR_um, 1e-5, `${prefix} ExitAperture2MaxR`);
      expect(s.nozzleClipping, `${prefix} Clipping`).toBe(GOLDEN_DEFAULT.nozzleClipping);
      expectClose(s.attackAngle_rad, GOLDEN_DEFAULT.attackAngle_rad, 1e-4, `${prefix} Attack_angle`);
    };

    assertAll18Golden(tsCompute(defaultIn).scalars, 'TS');
    assertAll18Golden(wasm.compute(defaultIn).scalars, 'WASM');

    await withCdpPage(async (page) => {
      await bootM4App(page);
      const uiMetrics = await page.evaluate<{
        pulseEnergyBase: number;
        pulseEnergyOutput: number;
        avgPower: number;
        peakPower: number;
        spotSize: number;
        rayleighRange: number;
        peakFluence: number;
        peakIrradiance: number;
        avgIrradiance: number;
        scanSpeed: number;
        spotOverlap: number;
        ablatedSpot: number;
        thresholdR: number;
        energyAboveThresh: number;
        exitAperture1MaxR: number;
        exitAperture2MaxR: number;
        nozzleBadge: string;
        attackAngleDeg: number;
      }>(`({
        pulseEnergyBase: window.__e2eWf.parseMetricNumber('#metricPulseEnergyBase'),
        pulseEnergyOutput: window.__e2eWf.parseMetricNumber('#metricPulseEnergyOutput'),
        avgPower: window.__e2eWf.parseMetricNumber('#metricAveragePower'),
        peakPower: window.__e2eWf.parseMetricNumber('#metricPeakPower'),
        spotSize: window.__e2eWf.parseMetricNumber('#metricSpotSize'),
        rayleighRange: window.__e2eWf.parseMetricNumber('#metricRayleighRange'),
        peakFluence: window.__e2eWf.parseMetricNumber('#metricPeakFluence'),
        peakIrradiance: window.__e2eWf.parseMetricNumber('#metricPeakIrradiance'),
        avgIrradiance: window.__e2eWf.parseMetricNumber('#metricAverageIrradiance'),
        scanSpeed: window.__e2eWf.parseMetricNumber('#metricScanSpeed'),
        spotOverlap: window.__e2eWf.parseMetricNumber('#metricSpotOverlap'),
        ablatedSpot: window.__e2eWf.parseMetricNumber('#metricAblatedSpot'),
        thresholdR: window.__e2eWf.parseMetricNumber('#metricThresholdR'),
        energyAboveThresh: window.__e2eWf.parseMetricNumber('#metricEnergyAboveThresh'),
        exitAperture1MaxR: window.__e2eWf.parseMetricNumber('#metricExitAperture1MaxR'),
        exitAperture2MaxR: window.__e2eWf.parseMetricNumber('#metricExitAperture2MaxR'),
        nozzleBadge: document.querySelector('#badgeNozzleClearance')?.textContent || '',
        attackAngleDeg: window.__e2eWf.parseMetricNumber('#readoutCurrentAngle'),
      })`);

      expectClose(uiMetrics.pulseEnergyBase, GOLDEN_DEFAULT.pulseEnergyBase_uJ, 1e-2, 'UI pulseEnergyBase');
      expectClose(uiMetrics.pulseEnergyOutput, GOLDEN_DEFAULT.pulseEnergyOutput_uJ, 1e-2, 'UI pulseEnergy');
      expectClose(uiMetrics.avgPower, GOLDEN_DEFAULT.avgPower_W, 1e-2, 'UI avgPower');
      expectClose(uiMetrics.peakPower, GOLDEN_DEFAULT.peakPower_MW, 1e-2, 'UI peakPower');
      expectClose(uiMetrics.spotSize, GOLDEN_DEFAULT.spotSize_um, 1e-2, 'UI spotSize');
      expectClose(uiMetrics.rayleighRange, GOLDEN_DEFAULT.rayleighRange_um, 1e-2, 'UI rayleighRange');
      expectClose(uiMetrics.peakFluence, GOLDEN_DEFAULT.peakFluence_J_cm2, 1e-2, 'UI peakFluence');
      expectClose(uiMetrics.peakIrradiance, GOLDEN_DEFAULT.peakIrradiance_TW_cm2, 1e-2, 'UI peakIrradiance');
      expectClose(uiMetrics.avgIrradiance, GOLDEN_DEFAULT.avgIrradiance_MW_cm2, 1e-2, 'UI avgIrradiance');
      expectClose(uiMetrics.scanSpeed, GOLDEN_DEFAULT.scanSpeed_mm_s, 1e-2, 'UI scanSpeed');
      expectClose(uiMetrics.spotOverlap, GOLDEN_DEFAULT.spotOverlap_pct, 1e-2, 'UI spotOverlap');
      expectClose(uiMetrics.ablatedSpot, GOLDEN_DEFAULT.ablatedSpotAt0_um, 1e-2, 'UI ablatedSpot');
      expectClose(uiMetrics.thresholdR, GOLDEN_DEFAULT.thresholdR, 1e-2, 'UI thresholdR');
      expectClose(uiMetrics.energyAboveThresh, GOLDEN_DEFAULT.energyAboveThresh_pct, 1e-2, 'UI energyAboveThresh');
      expectClose(uiMetrics.exitAperture1MaxR, GOLDEN_DEFAULT.exitAperture1MaxR_um, 1e-2, 'UI exitAperture1MaxR');
      expectClose(uiMetrics.exitAperture2MaxR, GOLDEN_DEFAULT.exitAperture2MaxR_um, 1e-2, 'UI exitAperture2MaxR');
      expect(uiMetrics.nozzleBadge).toMatch(/Nozzle Clipping/i);
      expectClose((uiMetrics.attackAngleDeg * Math.PI) / 180, GOLDEN_DEFAULT.attackAngle_rad, 1e-2, 'UI attackAngle_rad');

      for (const tabKey of ['profile|cross', 'topdown|multi|3d', 'isofluence|chart 1', 'fluence|distribution']) {
        await page.evaluate(`window.__e2eWf.selectTab("${tabKey}")`);
        await waitRaf(page, 2);
        const stats = await page.evaluate<{ distinctColors: number }>(
          'window.__e2eWf.getCanvasHash(window.__e2eWf.getVisibleCanvas())',
        );
        expect(stats.distinctColors, `Blank canvas on ${tabKey}`).toBeGreaterThan(2);
      }
      expect(page.consoleErrors).toEqual([]);
      expect(page.pageErrors).toEqual([]);
    });
  });

  it('T4-02: Micro-Via Tapered Drilling Optimization verifies overcut detection and clearance resolution', async () => {
    const presets = await loadPresetsContract();
    const compute = await loadTsEngineContract();

    const via = cloneDefaultInput(presets);
    via.entranceDia_um = 180;
    via.exitDia_um = 120;
    via.materialThick_um = 500;
    via.endDia_um = 220;
    via.endAOI = -3;
    via.endZ = -250;
    via.nozzleApertureDia_mm = 1.5;

    const overOut = compute(via);
    expect(overOut.scalars.nozzleClipping).toBe(false);
    expect(overOut.scalars.wallOvercut).toBe(true);
    expect(overOut.scalars.maxOvercut_um).toBeGreaterThan(0);

    const viaFixed = cloneDefaultInput(presets);
    viaFixed.entranceDia_um = 180;
    viaFixed.exitDia_um = 120;
    viaFixed.materialThick_um = 500;
    viaFixed.endDia_um = 40;
    viaFixed.endAOI = -1.0;
    viaFixed.endZ = -250;
    viaFixed.nozzleApertureDia_mm = 1.5;

    const fixedOut = compute(viaFixed);
    expect(fixedOut.scalars.nozzleClipping).toBe(false);
    expect(fixedOut.scalars.wallOvercut).toBe(false);
    expect(fixedOut.scalars.maxOvercut_um).toBe(0);

    await withCdpPage(async (page) => {
      await bootM4App(page);
      await page.evaluate(`(() => {
        window.__e2eWf.setInput('#inputEntranceDia', 180);
        window.__e2eWf.setInput('#inputExitDia', 120);
        window.__e2eWf.setInput('#inputMaterialThick', 500);
        window.__e2eWf.setInput('#inputEndDia', 220);
        window.__e2eWf.setInput('#inputEndAOI', -3);
        window.__e2eWf.setInput('#inputEndZ', -250);
        window.__e2eWf.setInput('#overrideNozzleDia', 1.5);
      })()`);
      await page.waitFor(
        '(document.querySelector("#badgeWallClearance")?.textContent || "").includes("Overcut")',
      );
      const warnBadge = await page.evaluate<string>(
        'document.querySelector("#badgeWallClearance")?.textContent || ""',
      );

      await page.evaluate(`(() => {
        window.__e2eWf.setInput('#inputEndDia', 40);
        window.__e2eWf.setInput('#inputEndAOI', -1.0);
      })()`);
      await page.waitFor(
        '(document.querySelector("#badgeWallClearance")?.textContent || "").includes("Within Limit")',
      );
      const okBadge = await page.evaluate<string>(
        'document.querySelector("#badgeWallClearance")?.textContent || ""',
      );
      expect(okBadge).not.toBe(warnBadge);

      await page.evaluate('window.__e2eWf.selectTab("topdown|multi|3d")');
      await waitRaf(page, 2);
      await page.evaluate('window.__e2eWf.clickControl("Table|Numeric", "[role=\\"tabpanel\\"]:not([hidden]), .canvas-tab-panel.active, .canvas-actions, .canvas-header")');
      const tableRows = await page.evaluate<number>(
        'window.__e2eWf.getActiveTable()?.querySelectorAll("tr").length || 0',
      );
      expect(tableRows).toBeGreaterThan(1);
    });
  });

  it('T4-03: Green 515 nm High-NA Precision Trepanning workflow across mismatch, Tab 3, and Tab 4', async () => {
    await withCdpPage(async (page) => {
      await bootM4App(page);
      await page.evaluate('window.__e2eWf.selectOptionByText("#selectLaser", "Charmilles Femto FlexiPulse Green")');
      await page.waitFor(
        '(() => { const w = document.querySelector("#warnWavelengthMismatch"); return Boolean(w && !w.hidden && /match/i.test(w.textContent || "")); })()',
      );
      const warnText = await page.evaluate<string>(
        'document.querySelector("#warnWavelengthMismatch")?.textContent || ""',
      );
      expect(warnText.toLowerCase()).toContain('match');

      await page.evaluate('window.__e2eWf.selectOptionByText("#selectScanhead", "Scanlab PrecSYS Green")');
      await page.evaluate('window.__e2eWf.setInput("#overridePulseWidth", "")');
      await page.waitFor(
        '(() => { const w = document.querySelector("#warnWavelengthMismatch"); const hidden = !w || w.hidden || getComputedStyle(w).display === "none"; const spot = window.__e2eWf.parseMetricNumber("#metricSpotSize"); return hidden && Math.abs(spot - 7.73) < 0.05; })()',
      );

      const warnHidden = await page.evaluate<boolean>(`(() => {
        const w = document.querySelector('#warnWavelengthMismatch');
        return !w || w.hidden || getComputedStyle(w).display === 'none' || (w.textContent || '').trim() === '';
      })()`);
      expect(warnHidden).toBe(true);

      const spot = await page.evaluate<number>('window.__e2eWf.parseMetricNumber("#metricSpotSize")');
      const zr = await page.evaluate<number>('window.__e2eWf.parseMetricNumber("#metricRayleighRange")');
      expectClose(spot, 7.7282192, 1e-2, '515nm spot size');
      expectClose(zr, 75.349013, 1e-2, '515nm rayleigh range');

      await page.evaluate('window.__e2eWf.selectTab("isofluence|chart 1")');
      await waitRaf(page, 2);
      const beforeIso = await page.evaluate<number>(
        'window.__e2eWf.getCanvasHash(window.__e2eWf.getVisibleCanvas()).hash',
      );
      await page.evaluate('window.__e2eWf.setInput("Z From Focus", 75)');
      await page.waitFor(
        `window.__e2eWf.getCanvasHash(window.__e2eWf.getVisibleCanvas()).hash !== ${beforeIso}`,
      );

      await page.evaluate('window.__e2eWf.selectTab("fluence|distribution|chart 6")');
      await waitRaf(page, 2);
      expect(page.consoleErrors).toEqual([]);
      expect(page.pageErrors).toEqual([]);
    });
  });

  it('T4-04: Transition Taper Sweep & Scrubber Playback interpolates state and syncs Tab 1 & Tab 2', async () => {
    await withCdpPage(async (page) => {
      await bootM4App(page);
      await page.evaluate(`(() => {
        window.__e2eWf.clickControl('#radioTransitionState|Transition');
        window.__e2eWf.setInput('#inputStartDia', 100);
        window.__e2eWf.setInput('#inputStartAOI', -2);
        window.__e2eWf.setInput('#inputStartZ', -300);
        window.__e2eWf.setInput('#inputEndDia', 420);
        window.__e2eWf.setInput('#inputEndAOI', -7.5);
        window.__e2eWf.setInput('#inputEndZ', -1100);
        window.__e2eWf.setInput('#overrideNozzleDia', 1.0);
        window.__e2eWf.setInput('#sliderProgress', 50);
      })()`);
      await page.waitFor(
        '(document.querySelector("#readoutCurrentRadius")?.textContent || "").includes("130") && (document.querySelector("#readoutCurrentZShift")?.textContent || "").includes("700")',
      );

      const readouts50 = await page.evaluate<{ radius: string; zshift: string }>(`({
        radius: document.querySelector('#readoutCurrentRadius')?.textContent || '',
        zshift: document.querySelector('#readoutCurrentZShift')?.textContent || '',
      })`);
      expect(readouts50.radius).toContain('130'); // (100+420)/2 / 2 = 130 um radius
      expect(readouts50.zshift).toContain('700'); // (-300 + -1100)/2 -> +700 um

      await page.evaluate('window.__e2eWf.selectTab("topdown|multi|3d")');
      await waitRaf(page, 2);
      const h50 = await page.evaluate<number>(
        'window.__e2eWf.getCanvasHash(window.__e2eWf.getVisibleCanvas()).hash',
      );

      await page.evaluate('window.__e2eWf.setInput("#sliderProgress", 100)');
      await page.waitFor(
        `window.__e2eWf.getCanvasHash(window.__e2eWf.getVisibleCanvas()).hash !== ${h50}`,
      );
      const h100 = await page.evaluate<number>(
        'window.__e2eWf.getCanvasHash(window.__e2eWf.getVisibleCanvas()).hash',
      );
      expect(h100).not.toBe(h50);
      expect(page.pageErrors).toEqual([]);
    });
  });

  it('T4-05: Offline PWA dist/ Workbox, Zero-Leak Build Audit, Subpath Hosting & Offline Compute', async () => {
    const distDir = assertDeliverableExists('dist', 'M1');
    const files = walkFiles(distDir);

    // 1. Zero-leak audit (read-only on dist/)
    const leaks = files.filter((f) =>
      /(CNAME|\.xlsx$|inspect_.*\.py$|dump_specs\.py$|test_math\.py$|main_cells\.txt$|defined_names\.json$|sheet_.*\.json$)/i.test(
        f,
      ),
    );
    expect(leaks).toEqual([]);

    for (const f of files.filter((x) => /\.(html|js|css)$/i.test(x))) {
      const txt = fs.readFileSync(resolveWorkspacePath('dist', f), 'utf8');
      expect(/SharedArrayBuffer|Cross-Origin-Opener-Policy|Cross-Origin-Embedder-Policy/.test(txt)).toBe(
        false,
      );
    }

    // 2. Manifest, icons, wasm, SW precache checks
    const manifest = JSON.parse(
      fs.readFileSync(assertDeliverableExists('dist/manifest.webmanifest', 'M1'), 'utf8'),
    ) as { id?: string; start_url?: string; scope?: string; display?: string };
    expect(manifest.id).toBe('./');
    expect(manifest.start_url).toBe('./');
    expect(manifest.scope).toBe('./');
    expect(manifest.display).toBe('standalone');

    expect(parsePngInfo(assertDeliverableExists('dist/pwa-192x192.png', 'M1')).width).toBe(192);
    expect(parsePngInfo(assertDeliverableExists('dist/pwa-512x512.png', 'M1')).width).toBe(512);
    expect(parsePngInfo(assertDeliverableExists('dist/pwa-maskable-512x512.png', 'M1')).topLeftPixelRGBA[3]).toBe(255);
    expect(parsePngInfo(assertDeliverableExists('dist/apple-touch-icon-180x180.png', 'M1')).width).toBe(180);

    const wasmDist = files.find((f) => f.endsWith('.wasm'));
    if (!wasmDist) {
      throw new Error('Waiting for M2/M4: no compiled .wasm asset found in dist/');
    }
    const swText = fs.readFileSync(assertDeliverableExists('dist/sw.js', 'M1'), 'utf8');
    expect(swText).toContain(wasmDist);

    // 3. Subpath browser offline reload + live recalculation
    await withCdpPage(async (page) => {
      await bootM4App(page);
      const swActive = await page.evaluate<boolean>(`(async () => {
        const reg = await Promise.race([
          navigator.serviceWorker.ready,
          new Promise((r) => setTimeout(() => r(null), 6000)),
        ]);
        return Boolean(reg && reg.active);
      })()`);
      expect(swActive).toBe(true);

      await page.setOffline(true);
      page.clearLogs();
      await page.reload();
      await page.waitFor('document.readyState === "complete"');
      await page.evaluate(WORKFLOW_HELPERS);
      await page.waitFor(
        '(() => { const b = document.querySelector("#badgeEngineBackend")?.textContent || ""; const s = document.querySelector("#metricSpotSize")?.textContent || ""; return b.length > 0 && !/Initializing/i.test(b) && s.trim().length > 0 && s.trim() !== "--"; })()',
      );

      await page.evaluate('window.__e2eWf.setInput("#inputBasePower", 80)');
      await page.waitFor(
        'Math.abs(window.__e2eWf.parseMetricNumber("#metricPulseEnergyOutput") - 360) < 1',
      );
      const energy = await page.evaluate<number>(
        'window.__e2eWf.parseMetricNumber("#metricPulseEnergyOutput")',
      );
      expectClose(energy, 360, 1e-2, 'offline recalculated PulseEnergyOutput');
      expect(page.pageErrors).toEqual([]);
    });
  });

  it('T4-06: Config Export, Malicious Import Rejection & Valid Edit-Import Roundtrip Sync', async () => {
    const presets = await loadPresetsContract();
    const schema = await loadSchemaContract();

    await withCdpPage(async (page) => {
      await bootM4App(page, true);
      // Wait briefly for SW offline-ready toast if active, then clear pre-existing toasts
      await page.evaluate(`(async () => {
        if ('serviceWorker' in navigator) {
          await Promise.race([navigator.serviceWorker.ready, new Promise((r) => setTimeout(r, 1500))]);
        }
        await new Promise((r) => setTimeout(r, 80));
        window.__e2eWf.dismissAllToasts();
      })()`);

      // Negative imports via schema + UI
      for (const bad of [
        '{"__proto__":{"polluted":true}}',
        '{invalid json',
        '{"basePower_W": -100, "unknown": 1}',
      ]) {
        expect(schema.validateAndParse(bad).ok).toBe(false);
        await page.evaluate('window.__e2eWf.dismissAllToasts()');
        await page.waitFor(
          '!document.querySelector("[popover=\\"manual\\"]")?.matches(":popover-open")',
        );
        await page.evaluate(`(() => {
          const inputEl = document.querySelector('#fileImportInput');
          const file = new File([${JSON.stringify(bad)}], 'bad.json', { type: 'application/json' });
          const dt = new DataTransfer();
          dt.items.add(file);
          inputEl.files = dt.files;
          inputEl.dispatchEvent(new Event('change', { bubbles: true }));
        })()`);
        await page.waitFor(
          '(() => { const pop = document.querySelector("[popover=\\"manual\\"]"); return Boolean(pop && pop.matches(":popover-open") && /Invalid Configuration File/i.test(pop.textContent || "")); })()',
        );
        const toastCheck = await page.evaluate<{ open: boolean; text: string }>(`(() => {
          const pop = document.querySelector('[popover="manual"]');
          return {
            open: Boolean(pop && pop.matches(':popover-open')),
            text: (pop?.textContent || '').trim(),
          };
        })()`);
        expect(toastCheck.open, `Error toast popover not open for bad JSON: ${bad}`).toBe(true);
        expect(toastCheck.text, `Missing error message for bad JSON: ${bad}`).toMatch(
          /Invalid Configuration File/i,
        );
      }

      // Valid roundtrip edit -> import
      const cfg = cloneDefaultInput(presets);
      cfg.laserId = findLaserByName(presets, 'Coherent Monaco').id;
      cfg.scanheadId = findScanheadByName(presets, 'Arges Elephant v2 IR').id;
      cfg.basePower_W = 50;
      cfg.stateMode = 'transition';
      cfg.transitionProgress_pct = 40;
      cfg.jobScaling = 1.15;
      cfg.nodeScaling = 0.9;
      cfg.divergenceMode = 'legacy';
      cfg.graphLimits = { zMin_um: -800, zMax_um: 2000, rMin_um: -150, rMax_um: 250 };
      const validJson = schema.exportJson(cfg);

      await page.evaluate(`(() => {
        const inputEl = document.querySelector('#fileImportInput');
        const file = new File([${JSON.stringify(validJson)}], 'valid.json', { type: 'application/json' });
        const dt = new DataTransfer();
        dt.items.add(file);
        inputEl.files = dt.files;
        inputEl.dispatchEvent(new Event('change', { bubbles: true }));
      })()`);
      await page.waitFor(
        'Number(document.querySelector("#inputBasePower")?.value) === 50 && Number(document.querySelector("#sliderProgress")?.value) === 40 && Math.abs(Number(document.querySelector("#inputJobScaling")?.value) - 1.15) < 1e-6 && !/Initializing/i.test(document.querySelector("#badgeEngineBackend")?.textContent || "")',
      );
      const synced = await page.evaluate<{ power: number; progress: number; jobScale: number }>(`({
        power: Number(document.querySelector('#inputBasePower').value),
        progress: Number(document.querySelector('#sliderProgress').value),
        jobScale: Number(document.querySelector('#inputJobScaling').value),
      })`);

      expect(synced.power).toBe(50);
      expect(synced.progress).toBe(40);
      expectClose(synced.jobScale, 1.15, 1e-6);
      expect(page.pageErrors).toEqual([]);
    });
  });
});
