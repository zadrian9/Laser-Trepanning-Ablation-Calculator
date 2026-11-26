import { describe, expect, it } from 'vitest';
import { DEFAULT_CALCULATOR_INPUT } from '../src/data/presets.ts';
import { computePhysicsTS } from '../src/math/engine.ts';
import {
  BaseInteractiveCanvas,
  buildSummaryTableElement,
  computeNiceTicks,
  expandBounds,
  fitBoundsToViewport,
  formatNumberSafe,
  panViewport,
  pinchZoomViewport,
  resolveThemePalette,
  screenToWorld,
  strokePolylineWithNaNBreaks,
  worldToScreen,
  zoomViewportAt,
  type SummaryTableSpec,
} from '../src/render/baseCanvas.ts';
import {
  FluenceCanvasRenderer,
  computeFluenceSplitGeometry,
} from '../src/render/fluenceCanvas.ts';
import {
  DEFAULT_ISOFLUENCE_VISIBILITY,
  IsofluenceCanvasRenderer,
  type IsofluenceContourKey,
} from '../src/render/isofluenceCanvas.ts';
import {
  ProfileCanvasRenderer,
  normalizeGraphLimits,
} from '../src/render/profileCanvas.ts';
import {
  TopDownCanvasRenderer,
  classifySafetyState,
  extractSafetyHeatmapCells,
  orbitDegreesToIndex,
  renderSafetyHeatmap,
} from '../src/render/topDownCanvas.ts';
import {
  ISO_COL,
  SWEEP_STATES,
  SWEEP_STRIDE,
  type CalculatorInput,
} from '../src/types/physics.ts';

function withInput(overrides: Partial<CalculatorInput>): CalculatorInput {
  return {
    ...DEFAULT_CALCULATOR_INPUT,
    graphLimits: { ...DEFAULT_CALCULATOR_INPUT.graphLimits },
    ...overrides,
  };
}

interface MockOpCounts {
  save: number;
  restore: number;
  setTransform: number;
  resetTransform: number;
  scale: number;
  beginPath: number;
  closePath: number;
  moveTo: number;
  lineTo: number;
  arc: number;
  stroke: number;
  fill: number;
  fillRect: number;
  strokeRect: number;
  setLineDash: number;
  fillText: number;
}

class MockCanvasRenderingContext2D {
  opCounts: MockOpCounts = {
    save: 0,
    restore: 0,
    setTransform: 0,
    resetTransform: 0,
    scale: 0,
    beginPath: 0,
    closePath: 0,
    moveTo: 0,
    lineTo: 0,
    arc: 0,
    stroke: 0,
    fill: 0,
    fillRect: 0,
    strokeRect: 0,
    setLineDash: 0,
    fillText: 0,
  };
  nonFiniteErrors: string[] = [];
  recordedPoints: Array<{ op: 'moveTo' | 'lineTo'; x: number; y: number; lineWidth: number }> = [];
  totalCalls = 0;
  fillStyle = '#000000';
  strokeStyle = '#000000';
  lineWidth = 1;
  font = '10px sans-serif';
  textAlign = 'left';
  textBaseline = 'alphabetic';
  globalAlpha = 1;

  resetStats(): void {
    for (const k of Object.keys(this.opCounts) as Array<keyof MockOpCounts>) {
      this.opCounts[k] = 0;
    }
    this.nonFiniteErrors = [];
    this.recordedPoints = [];
    this.totalCalls = 0;
  }

  private checkFinite(op: string, a: number, b?: number, c?: number, d?: number, e?: number, f?: number): void {
    const vals = [a, b, c, d, e, f];
    for (let i = 0; i < vals.length; i++) {
      const v = vals[i];
      if (v !== undefined && !Number.isFinite(v)) {
        this.nonFiniteErrors.push(`Non-finite arg[${i}] in ${op}: ${v}`);
      }
    }
  }

  save(): void {
    this.opCounts.save++;
    this.totalCalls++;
  }
  restore(): void {
    this.opCounts.restore++;
    this.totalCalls++;
  }
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void {
    this.checkFinite('setTransform', a, b, c, d, e, f);
    this.opCounts.setTransform++;
    this.totalCalls++;
  }
  resetTransform(): void {
    this.opCounts.resetTransform++;
    this.totalCalls++;
  }
  scale(x: number, y: number): void {
    this.checkFinite('scale', x, y);
    this.opCounts.scale++;
    this.totalCalls++;
  }
  beginPath(): void {
    this.opCounts.beginPath++;
    this.totalCalls++;
  }
  closePath(): void {
    this.opCounts.closePath++;
    this.totalCalls++;
  }
  moveTo(x: number, y: number): void {
    this.checkFinite('moveTo', x, y);
    this.recordedPoints.push({ op: 'moveTo', x, y, lineWidth: this.lineWidth });
    this.opCounts.moveTo++;
    this.totalCalls++;
  }
  lineTo(x: number, y: number): void {
    this.checkFinite('lineTo', x, y);
    this.recordedPoints.push({ op: 'lineTo', x, y, lineWidth: this.lineWidth });
    this.opCounts.lineTo++;
    this.totalCalls++;
  }
  arc(x: number, y: number, r: number, s: number, e: number): void {
    this.checkFinite('arc', x, y, r, s, e);
    this.opCounts.arc++;
    this.totalCalls++;
  }
  stroke(): void {
    this.opCounts.stroke++;
    this.totalCalls++;
  }
  fill(): void {
    this.opCounts.fill++;
    this.totalCalls++;
  }
  fillRect(x: number, y: number, w: number, h: number): void {
    this.checkFinite('fillRect', x, y, w, h);
    this.opCounts.fillRect++;
    this.totalCalls++;
  }
  strokeRect(x: number, y: number, w: number, h: number): void {
    this.checkFinite('strokeRect', x, y, w, h);
    this.opCounts.strokeRect++;
    this.totalCalls++;
  }
  setLineDash(_segments: number[]): void {
    this.opCounts.setLineDash++;
    this.totalCalls++;
  }
  fillText(_text: string, x: number, y: number): void {
    this.checkFinite('fillText', x, y);
    this.opCounts.fillText++;
    this.totalCalls++;
  }
  measureText(text: string): { width: number } {
    return { width: text.length * 6 };
  }
}

interface MockCanvasHandle {
  canvas: HTMLCanvasElement;
  ctx: MockCanvasRenderingContext2D;
  setRect: (w: number, h: number) => void;
  dispatch: (type: string, eventInit?: Record<string, unknown>) => void;
}

function createMockCanvas(width = 640, height = 480): MockCanvasHandle {
  let rectW = width;
  let rectH = height;
  const listeners = new Map<string, Array<(ev: unknown) => void>>();
  const ctx = new MockCanvasRenderingContext2D();

  const canvasObj = {
    width,
    height,
    style: {} as CSSStyleDeclaration,
    getContext: (kind: string) => (kind === '2d' ? ctx : null),
    getBoundingClientRect: () => ({
      left: 0,
      top: 0,
      width: rectW,
      height: rectH,
      right: rectW,
      bottom: rectH,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }),
    addEventListener: (type: string, cb: (ev: unknown) => void) => {
      const list = listeners.get(type) ?? [];
      list.push(cb);
      listeners.set(type, list);
    },
    removeEventListener: (type: string, cb: (ev: unknown) => void) => {
      const list = listeners.get(type) ?? [];
      listeners.set(
        type,
        list.filter((fn) => fn !== cb),
      );
    },
    setPointerCapture: () => {},
    releasePointerCapture: () => {},
    toBlob: (cb: (blob: Blob | null) => void, mime = 'image/png') => {
      cb(new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: mime }));
    },
  };

  return {
    canvas: canvasObj as unknown as HTMLCanvasElement,
    ctx,
    setRect: (w: number, h: number) => {
      rectW = w;
      rectH = h;
    },
    dispatch: (type: string, eventInit: Record<string, unknown> = {}) => {
      const ev = { preventDefault: () => {}, ...eventInit };
      for (const fn of listeners.get(type) ?? []) {
        fn(ev);
      }
    },
  };
}

function assertAllDrawArgsFinite(ctx: MockCanvasRenderingContext2D): void {
  expect(ctx.nonFiniteErrors).toEqual([]);
}

const DEFAULT_OUTPUT = computePhysicsTS(DEFAULT_CALCULATOR_INPUT);

interface MockNode {
  tagName: string;
  className: string;
  textContent: string;
  attributes: Record<string, string>;
  children: MockNode[];
  firstChild: MockNode | null;
  appendChild: (child: MockNode) => MockNode;
  removeChild: (child: MockNode) => MockNode;
  replaceChildren: (...nodes: MockNode[]) => void;
  setAttribute: (k: string, v: string) => void;
  getAttribute: (k: string) => string | null;
  ownerDocument?: Document;
}

function createMockDocument(): Document {
  const makeNode = (tagName: string): MockNode => {
    const node: MockNode = {
      tagName: tagName.toUpperCase(),
      className: '',
      textContent: '',
      attributes: {},
      children: [],
      get firstChild() {
        return this.children[0] ?? null;
      },
      appendChild(child: MockNode) {
        this.children.push(child);
        return child;
      },
      removeChild(child: MockNode) {
        this.children = this.children.filter((c) => c !== child);
        return child;
      },
      replaceChildren(...nodes: MockNode[]) {
        this.children = [...nodes];
      },
      setAttribute(k: string, v: string) {
        this.attributes[k] = v;
      },
      getAttribute(k: string) {
        return this.attributes[k] ?? null;
      },
    };
    return node;
  };

  return {
    createElement: (tag: string) => makeNode(tag),
  } as unknown as Document;
}

function collectText(node: MockNode): string {
  if (node.children.length === 0) return node.textContent;
  return (
    node.textContent +
    node.children.map((c) => collectText(c)).join(' ')
  );
}

describe('BaseInteractiveCanvas & Pure Viewport Math', () => {
  it('round-trips worldToScreen and screenToWorld for both invertY modes', () => {
    for (const invertY of [true, false]) {
      const vp = fitBoundsToViewport(
        { minX: -400, maxX: 800, minY: -200, maxY: 600 },
        800,
        600,
        { lockAspect: true, invertY },
      );

      const sample = { x: 123.45, y: -67.89 };
      const sc = worldToScreen(vp, sample.x, sample.y);
      const back = screenToWorld(vp, sc.x, sc.y);
      expect(back.x).toBeCloseTo(sample.x, 9);
      expect(back.y).toBeCloseTo(sample.y, 9);
    }
  });

  it('keeps anchor world coordinate invariant under zoomViewportAt and enforces clamps', () => {
    const base = fitBoundsToViewport(
      { minX: -500, maxX: 500, minY: -500, maxY: 500 },
      600,
      600,
      { lockAspect: true, invertY: true, minZoomFactor: 0.2, maxZoomFactor: 10 },
    );

    const anchorScreen = { x: 245, y: 310 };
    const worldBefore = screenToWorld(base, anchorScreen.x, anchorScreen.y);

    const zoomed = zoomViewportAt(base, anchorScreen.x, anchorScreen.y, 2.5);
    const worldAfter = screenToWorld(zoomed, anchorScreen.x, anchorScreen.y);
    expect(worldAfter.x).toBeCloseTo(worldBefore.x, 8);
    expect(worldAfter.y).toBeCloseTo(worldBefore.y, 8);
    expect(zoomed.scaleX).toBeCloseTo(zoomed.scaleY, 12);

    // Extreme zoom out/in clamp preserves lockAspect
    const maxZoomed = zoomViewportAt(base, 300, 300, 1e6);
    expect(maxZoomed.scaleX).toBeCloseTo(base.baseScaleX * 10, 9);
    expect(maxZoomed.scaleY).toBeCloseTo(maxZoomed.scaleX, 9);

    const minZoomed = zoomViewportAt(base, 300, 300, 1e-6);
    expect(minZoomed.scaleX).toBeCloseTo(base.baseScaleX * 0.2, 9);
    expect(minZoomed.scaleY).toBeCloseTo(minZoomed.scaleX, 9);
  });

  it('pans and pinch-zooms accurately with collapsed-distance fallback', () => {
    const vp = fitBoundsToViewport(
      { minX: -100, maxX: 100, minY: -100, maxY: 100 },
      400,
      400,
      { lockAspect: true, invertY: true },
    );

    const panned = panViewport(vp, 40, -25);
    expect(panned.offsetX).toBeCloseTo(vp.offsetX + 40, 9);
    expect(panned.offsetY).toBeCloseTo(vp.offsetY - 25, 9);

    const p1Prev = { x: 150, y: 200 };
    const p2Prev = { x: 250, y: 200 };
    const p1Curr = { x: 120, y: 220 };
    const p2Curr = { x: 320, y: 220 };
    const midPrevWorld = screenToWorld(vp, 200, 200);
    const pinched = pinchZoomViewport(vp, p1Prev, p2Prev, p1Curr, p2Curr);
    const midCurrWorld = screenToWorld(pinched, 220, 220);

    expect(pinched.scaleX).toBeCloseTo(vp.scaleX * 2, 8);
    expect(midCurrWorld.x).toBeCloseTo(midPrevWorld.x, 8);
    expect(midCurrWorld.y).toBeCloseTo(midPrevWorld.y, 8);

    // Degenerate zero-distance pinch degrades safely to translation
    const fallbackPan = pinchZoomViewport(
      vp,
      { x: 100, y: 100 },
      { x: 100, y: 100 },
      { x: 130, y: 120 },
      { x: 130, y: 120 },
    );
    expect(fallbackPan.offsetX).toBeCloseTo(vp.offsetX + 30, 9);
    expect(fallbackPan.offsetY).toBeCloseTo(vp.offsetY + 20, 9);
  });

  it('computes nice ticks, expands bounds safely, and breaks polylines cleanly on NaN', () => {
    const nice = computeNiceTicks(-120, 480, 480, 80);
    expect(nice.step).toBe(100);
    expect(nice.ticks).toEqual([-100, 0, 100, 200, 300, 400]);

    const expanded = expandBounds(
      { minX: 0, maxX: 100, minY: -50, maxY: 50 },
      { minX: 300, maxX: -200, minY: 120, maxY: -120 },
    );
    expect(expanded).toEqual({ minX: -200, maxX: 300, minY: -120, maxY: 120 });

    const ctx = new MockCanvasRenderingContext2D();
    const xs = [0, 10, 20, Number.NaN, 40, 50, 60, Number.NaN, 80];
    const ys = [0, 5, 10, 15, 20, 25, 30, Number.NaN, 40];
    const segments = strokePolylineWithNaNBreaks(
      ctx as unknown as CanvasRenderingContext2D,
      xs.length,
      (i) => (Number.isFinite(xs[i]) && Number.isFinite(ys[i]) ? { x: xs[i], y: ys[i] } : null),
    );
    expect(segments).toBe(2);
    expect(ctx.opCounts.moveTo).toBe(2);
    expect(ctx.opCounts.stroke).toBe(2);
    assertAllDrawArgsFinite(ctx);
  });

  it('handles 0x0 hidden-tab skip, Pointer Events, theme switch, PNG export, and zero-innerHTML table', async () => {
    const mock = createMockCanvas(0, 0);
    const crosshairs: Array<unknown> = [];
    const output = DEFAULT_OUTPUT;

    const renderer = new ProfileCanvasRenderer(mock.canvas, {
      defaultTheme: 'dark',
      onCrosshairChange: (r) => crosshairs.push(r),
    });

    expect(renderer).toBeInstanceOf(BaseInteractiveCanvas);
    expect(mock.canvas.style.touchAction).toBe('none');
    // 0x0 hidden tab must NOT overwrite backing store width/height with 0
    expect(renderer.resize()).toBe(false);

    mock.setRect(640, 480);
    renderer.setVisible(true);
    renderer.setOutput(output);
    expect(mock.canvas.width).toBe(640);
    expect(mock.canvas.height).toBe(480);
    assertAllDrawArgsFinite(mock.ctx);

    // 1-pointer pan & pointerleave
    const vpBefore = renderer.getViewportState();
    mock.dispatch('pointerdown', { pointerId: 1, button: 0, pointerType: 'mouse', clientX: 200, clientY: 200 });
    mock.dispatch('pointermove', { pointerId: 1, clientX: 250, clientY: 230 });
    const vpAfterPan = renderer.getViewportState();
    expect(vpAfterPan.offsetX).toBeCloseTo(vpBefore.offsetX + 50, 9);
    expect(vpAfterPan.offsetY).toBeCloseTo(vpBefore.offsetY + 30, 9);
    mock.dispatch('pointerup', { pointerId: 1 });
    mock.dispatch('pointerleave', {});
    expect(crosshairs[crosshairs.length - 1]).toBeNull();

    // pointercancel clears drag state cleanly
    mock.dispatch('pointerdown', { pointerId: 2, button: 0, pointerType: 'touch', clientX: 100, clientY: 100 });
    mock.dispatch('pointercancel', { pointerId: 2 });
    const vpBeforeMove = renderer.getViewportState();
    mock.dispatch('pointermove', { pointerId: 2, clientX: 180, clientY: 160 });
    expect(renderer.getViewportState().offsetX).toBeCloseTo(vpBeforeMove.offsetX, 9);

    // Wheel zoom + resetView
    mock.dispatch('wheel', { clientX: 320, clientY: 240, deltaY: -120, deltaMode: 0 });
    expect(renderer.getViewportState().scaleX).toBeGreaterThan(vpBeforeMove.scaleX);
    renderer.resetView();
    expect(renderer.getViewportState().scaleX).toBeCloseTo(vpBefore.scaleX, 8);

    // Theme switch
    const darkPalette = resolveThemePalette('dark');
    const lightPalette = resolveThemePalette('light');
    expect(darkPalette.bg).not.toBe(lightPalette.bg);
    renderer.setTheme('light');
    expect(renderer.getTheme()).toBe('light');

    // PNG export
    const exported = await renderer.exportPNG('profile.png');
    expect(exported).toBe(true);

    // Zero-innerHTML semantic DOM table
    const doc = createMockDocument();
    const container = doc.createElement('div') as unknown as HTMLElement & {
      ownerDocument?: Document;
    };
    container.ownerDocument = doc;
    const table = renderer.renderSummaryTable(container) as unknown as MockNode;
    expect(table.tagName).toBe('TABLE');
    expect(table.children[0].tagName).toBe('CAPTION');
    const thead = table.children[1];
    expect(thead.children[0].children[0].getAttribute('scope')).toBe('col');
    const tableText = collectText(table);
    expect(tableText).not.toContain('NaN');
    expect(tableText).not.toContain('undefined');

    renderer.destroy();
  });

  it('buildSummaryTableElement formats safely with zero NaN/undefined', () => {
    expect(formatNumberSafe(Number.NaN, 2)).toBe('—');
    expect(formatNumberSafe(Number.POSITIVE_INFINITY, 2, 'N/A')).toBe('N/A');
    expect(formatNumberSafe(-0, 2)).toBe('0.00');

    const doc = createMockDocument();
    const spec: SummaryTableSpec = {
      caption: 'Test Summary',
      headers: ['Metric', 'Value'],
      rows: [['Peak', formatNumberSafe(190.02, 2)]],
    };
    const tbl = buildSummaryTableElement(spec, doc) as unknown as MockNode;
    expect(collectText(tbl)).toContain('Test Summary');
    expect(collectText(tbl)).toContain('190.02');
  });

  it('supports 2-pointer DOM pinch-zoom and skips explicit 0x0 canvas resize despite non-zero parentElement', () => {
    const mock = createMockCanvas(600, 400);
    const renderer = new ProfileCanvasRenderer(mock.canvas);
    renderer.setOutput(DEFAULT_OUTPUT);

    const vpBefore = renderer.getViewportState();
    mock.dispatch('pointerdown', { pointerId: 1, button: 0, pointerType: 'touch', clientX: 200, clientY: 200 });
    mock.dispatch('pointerdown', { pointerId: 2, button: 0, pointerType: 'touch', clientX: 300, clientY: 200 });
    mock.dispatch('pointermove', { pointerId: 2, clientX: 400, clientY: 200 });
    mock.dispatch('pointerup', { pointerId: 1 });
    mock.dispatch('pointerup', { pointerId: 2 });

    const vpAfter = renderer.getViewportState();
    expect(vpAfter.scaleX).toBeCloseTo(vpBefore.scaleX * 2, 6);
    expect(vpAfter.scaleY).toBeCloseTo(vpBefore.scaleY * 2, 6);
    assertAllDrawArgsFinite(mock.ctx);
    renderer.destroy();

    // Explicit 0x0 canvas rect must skip resize even when parentElement is non-zero
    const ctxZero = new MockCanvasRenderingContext2D();
    const zeroCanvas = {
      width: 123,
      height: 77,
      style: {} as CSSStyleDeclaration,
      getContext: (kind: string) => (kind === '2d' ? ctxZero : null),
      getBoundingClientRect: () => ({
        left: 0,
        top: 0,
        width: 0,
        height: 0,
        right: 0,
        bottom: 0,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }),
      parentElement: {
        getBoundingClientRect: () => ({
          left: 0,
          top: 0,
          width: 800,
          height: 600,
          right: 800,
          bottom: 600,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        }),
      },
    } as unknown as HTMLCanvasElement;

    const zeroRenderer = new ProfileCanvasRenderer(zeroCanvas);
    expect(zeroRenderer.resize()).toBe(false);
    expect(zeroCanvas.width).toBe(123);
    expect(zeroCanvas.height).toBe(77);
    zeroRenderer.destroy();

    // Missing getBoundingClientRect falls back cleanly to parentElement in mock environments
    const fallbackCanvas = {
      width: 100,
      height: 100,
      style: {} as CSSStyleDeclaration,
      getContext: (kind: string) => (kind === '2d' ? ctxZero : null),
      parentElement: {
        getBoundingClientRect: () => ({
          left: 0,
          top: 0,
          width: 800,
          height: 600,
          right: 800,
          bottom: 600,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        }),
      },
    } as unknown as HTMLCanvasElement;

    const fallbackRenderer = new ProfileCanvasRenderer(fallbackCanvas);
    expect(fallbackCanvas.width).toBe(800);
    expect(fallbackCanvas.height).toBe(600);
    fallbackRenderer.destroy();
  });
});

describe('Tab 1 — ProfileCanvasRenderer (Chart 2)', () => {
  it('supports vertical vs horizontal orientation, 2-plane nozzle Z alignment, and counter-beam without mutating scalars', () => {
    const output = DEFAULT_OUTPUT;
    const spotBefore = output.scalars.spotSize_um;
    const profileSampleBefore = output.trepanningProfile[0];

    const mock = createMockCanvas(720, 520);
    const renderer = new ProfileCanvasRenderer(mock.canvas);
    renderer.setOutput(output);
    assertAllDrawArgsFinite(mock.ctx);
    const verticalCalls = mock.ctx.totalCalls;

    renderer.setShowCounterBeam(true);
    expect(output.scalars.spotSize_um).toBe(spotBefore);
    expect(output.trepanningProfile[0]).toBe(profileSampleBefore);
    expect(mock.ctx.totalCalls).toBeGreaterThan(verticalCalls);
    assertAllDrawArgsFinite(mock.ctx);

    mock.ctx.resetStats();
    renderer.setOrientation('horizontal');
    assertAllDrawArgsFinite(mock.ctx);
    expect(renderer.getViewportState().invertY).toBe(true);

    // Part-frame nozzle Z alignment check: zNoz1 = nozzlePlane1Z_um + zShift_um
    const zNoz1Part = output.scalars.nozzlePlane1Z_um + output.scalars.zShift_um;
    const zNoz2Part = output.scalars.nozzlePlane2Z_um + output.scalars.zShift_um;
    expect(zNoz1Part).toBeCloseTo(-3400, 6);
    expect(zNoz2Part).toBeCloseTo(-1400, 6);
    expect(output.scalars.nozzleClipping).toBe(true);
    expect(output.scalars.wallOvercut).toBe(true);
  });

  it('guards inverted graphLimits, Mat_thk = 0, and all-NaN ablation curves cleanly', () => {
    const norm = normalizeGraphLimits({
      zMin_um: 1500,
      zMax_um: -500,
      rMin_um: 200,
      rMax_um: -200,
    });
    expect(norm).toEqual({
      zMin_um: -500,
      zMax_um: 1500,
      rMin_um: -200,
      rMax_um: 200,
    });

    const mock = createMockCanvas(640, 480);
    const renderer = new ProfileCanvasRenderer(mock.canvas);

    // Edge case 1: Mat_thk = 0 + inverted graphLimits
    const zeroThkOut = computePhysicsTS(
      withInput({
        materialThick_um: 0,
        endZ: 0,
        partSurface_Z_um: 0,
        graphLimits: { zMin_um: 1500, zMax_um: -500, rMin_um: 200, rMax_um: -200 },
      }),
    );
    renderer.setOptions({
      graphLimits: { zMin_um: 1500, zMax_um: -500, rMin_um: 200, rMax_um: -200 },
    });
    renderer.setOutput(zeroThkOut);
    assertAllDrawArgsFinite(mock.ctx);

    // Edge case 2: all-NaN ablation (F_th = 500 > F_0 = 190)
    mock.ctx.resetStats();
    const noAblOut = computePhysicsTS(withInput({ ablationThreshOverride_J_cm2: 500 }));
    renderer.setOutput(noAblOut);
    assertAllDrawArgsFinite(mock.ctx);

    const tableText = JSON.stringify(renderer.getSummaryTable());
    expect(tableText).not.toContain('NaN');
    expect(tableText).not.toContain('undefined');
  });

  it('refits orientation, fitMode, and graphLimits cleanly after user pan/zoom while preserving pan/zoom on routine updates', () => {
    const output = DEFAULT_OUTPUT;
    const mock = createMockCanvas(720, 520);
    const renderer = new ProfileCanvasRenderer(mock.canvas);
    renderer.setOutput(output);

    // User pans the chart (hasUserTransformed = true)
    mock.dispatch('pointerdown', { pointerId: 1, button: 0, pointerType: 'mouse', clientX: 200, clientY: 200 });
    mock.dispatch('pointermove', { pointerId: 1, clientX: 310, clientY: 260 });
    mock.dispatch('pointerup', { pointerId: 1 });
    const vpPanned = renderer.getViewportState();

    // Routine physics output or counter-beam toggle preserves user pan/zoom
    renderer.setShowCounterBeam(true);
    expect(renderer.getViewportState().offsetX).toBeCloseTo(vpPanned.offsetX, 6);
    expect(renderer.getViewportState().offsetY).toBeCloseTo(vpPanned.offsetY, 6);
    renderer.setOutput(output);
    expect(renderer.getViewportState().offsetX).toBeCloseTo(vpPanned.offsetX, 6);

    // Switching orientation after pan must reset transform, set invertY=true, and fit (Z, R) bounds
    mock.ctx.resetStats();
    renderer.setOrientation('horizontal');
    const vpHoriz = renderer.getViewportState();
    expect(vpHoriz.invertY).toBe(true);
    const ptPosR = worldToScreen(vpHoriz, output.scalars.partSurface_um, 200);
    const ptNegR = worldToScreen(vpHoriz, output.scalars.partSurface_um, -200);
    expect(ptPosR.y).toBeLessThan(ptNegR.y);
    expect(ptPosR.x).toBeGreaterThanOrEqual(0);
    expect(ptPosR.x).toBeLessThanOrEqual(720);
    assertAllDrawArgsFinite(mock.ctx);

    // Pan again, then update graphLimits + exact fitMode -> must refit to new limits
    mock.dispatch('pointerdown', { pointerId: 1, button: 0, pointerType: 'mouse', clientX: 250, clientY: 250 });
    mock.dispatch('pointermove', { pointerId: 1, clientX: 390, clientY: 320 });
    mock.dispatch('pointerup', { pointerId: 1 });
    const vpHorizPanned = renderer.getViewportState();

    renderer.setOptions({ fitMode: 'exact' });
    renderer.setGraphLimits({ zMin_um: -500, zMax_um: 500, rMin_um: -300, rMax_um: 300 });
    const vpExact = renderer.getViewportState();
    expect(vpExact.scaleX).not.toBeCloseTo(vpHorizPanned.scaleX, 3);
    const limTopLeft = worldToScreen(vpExact, -500, 300);
    const limBotRight = worldToScreen(vpExact, 500, -300);
    expect(limTopLeft.x).toBeGreaterThanOrEqual(0);
    expect(limTopLeft.y).toBeGreaterThanOrEqual(0);
    expect(limBotRight.x).toBeLessThanOrEqual(720);
    expect(limBotRight.y).toBeLessThanOrEqual(520);
    renderer.destroy();
  });
});

describe('Tab 2 — TopDownCanvasRenderer & Safety Heatmap', () => {
  it('renders all 4 modes, square vs round geometry, nozzle rings, and orbitIndex boundaries cleanly', () => {
    const roundOut = DEFAULT_OUTPUT;
    const mock = createMockCanvas(600, 600);
    const renderer = new TopDownCanvasRenderer(mock.canvas);

    const callCounts: number[] = [];
    for (const mode of ['beam_path', 'contour_1e2', 'contour_ablation', 'all'] as const) {
      mock.ctx.resetStats();
      renderer.setMode(mode);
      renderer.setOutput(roundOut);
      assertAllDrawArgsFinite(mock.ctx);
      callCounts.push(mock.ctx.totalCalls);
    }
    expect(callCounts[3]).toBeGreaterThan(callCounts[0]);

    // Orbit scrubber conversion & boundaries
    expect(orbitDegreesToIndex(0)).toBe(0);
    expect(orbitDegreesToIndex(180)).toBe(1000);
    expect(orbitDegreesToIndex(360)).toBe(2000);
    for (const idx of [0, 2000, 2002]) {
      mock.ctx.resetStats();
      renderer.setOrbitIndex(idx);
      assertAllDrawArgsFinite(mock.ctx);
    }

    // Square hole geometry uses distinct strokeRect boundaries
    const sqOut = computePhysicsTS(withInput({ holeType: 'square' }));
    mock.ctx.resetStats();
    renderer.setHoleType('square');
    renderer.setOutput(sqOut);
    assertAllDrawArgsFinite(mock.ctx);
    expect(mock.ctx.opCounts.strokeRect).toBeGreaterThanOrEqual(2);

    // All-NaN ablation mode (F_th = 300 > F_0)
    const noAblOut = computePhysicsTS(withInput({ ablationThreshOverride_J_cm2: 300 }));
    mock.ctx.resetStats();
    renderer.setMode('contour_ablation');
    renderer.setOutput(noAblOut);
    assertAllDrawArgsFinite(mock.ctx);

    const summaryStr = JSON.stringify(renderer.getSummaryTable());
    expect(summaryStr).toContain('No ablation');
    expect(summaryStr).not.toContain('NaN');
    expect(summaryStr).not.toContain('undefined');
  });

  it('classifies safety priority (clipping > overcut > safe) and renders 101-state heatmap strip', () => {
    expect(classifySafetyState(0, 0)).toBe('safe');
    expect(classifySafetyState(0, 1)).toBe('overcut');
    expect(classifySafetyState(1, 0)).toBe('clipping');
    expect(classifySafetyState(1, 1)).toBe('clipping');

    // Sweep that crosses safe -> clipping / overcut
    const transOut = computePhysicsTS(
      withInput({
        stateMode: 'transition',
        startDia_um: 100,
        startAOI: -2,
        startZ: -400,
        endDia_um: 450,
        endAOI: -7.5,
        endZ: -1100,
        nozzleApertureDia_mm: 1.18,
      }),
    );

    const cells = extractSafetyHeatmapCells(transOut.transitionSweep, 'dark');
    expect(cells).toHaveLength(SWEEP_STATES);
    expect(cells[0].status).toBe('safe');
    expect(cells[100].status).toBe('clipping');

    // Also test synthetic overcut-only cell color
    const synthSweep = new Float64Array(SWEEP_STATES * SWEEP_STRIDE);
    synthSweep[50 * SWEEP_STRIDE + 0] = 0;
    synthSweep[50 * SWEEP_STRIDE + 1] = 1;
    synthSweep[99 * SWEEP_STRIDE + 0] = 1;
    synthSweep[99 * SWEEP_STRIDE + 1] = 1;
    const synthCells = extractSafetyHeatmapCells(synthSweep, 'dark');
    expect(synthCells[0].status).toBe('safe');
    expect(synthCells[50].status).toBe('overcut');
    expect(synthCells[99].status).toBe('clipping');

    const stripMock = createMockCanvas(303, 18);
    renderSafetyHeatmap(stripMock.canvas, transOut.transitionSweep, 45, 'dark');
    expect(stripMock.ctx.opCounts.fillRect).toBe(101);
    assertAllDrawArgsFinite(stripMock.ctx);

    // 0x0 hidden strip skips safely
    stripMock.ctx.resetStats();
    stripMock.setRect(0, 0);
    renderSafetyHeatmap(stripMock.canvas, transOut.transitionSweep, 45, 'dark');
    expect(stripMock.ctx.totalCalls).toBe(0);
  });
});

describe('Tab 3 — IsofluenceCanvasRenderer (Chart 1)', () => {
  it('renders 10 symmetric contour pairs with NaN breaks, handles all-OFF toggles, and edge-guards Z = 9999', () => {
    const out = computePhysicsTS(withInput({ zFromFocusLookup_um: 150 }));
    // Confirm N_SPACER is NaN and excluded
    expect(Number.isNaN(out.isofluence[ISO_COL.N_SPACER])).toBe(true);

    const mock = createMockCanvas(680, 440);
    const renderer = new IsofluenceCanvasRenderer(mock.canvas, {}, {
      zFromFocusLookup_um: 150,
    });
    renderer.setOutput(out);
    assertAllDrawArgsFinite(mock.ctx);
    const allOnCalls = mock.ctx.totalCalls;

    // Toggle thermalDamage off -> fewer calls
    mock.ctx.resetStats();
    renderer.setContourVisible('thermalDamage', false);
    assertAllDrawArgsFinite(mock.ctx);
    expect(mock.ctx.totalCalls).toBeLessThan(allOnCalls);

    // Toggle ALL contours OFF cleanly
    const allOff = { ...DEFAULT_ISOFLUENCE_VISIBILITY };
    for (const k of Object.keys(allOff) as IsofluenceContourKey[]) {
      allOff[k] = false;
    }
    mock.ctx.resetStats();
    renderer.setOptions({ visibleContours: allOff });
    assertAllDrawArgsFinite(mock.ctx);

    // Z From Focus = 9999 (> zMax) edge guard: autoBounds maxX remains zMaxIsofluence_um
    const outFar = computePhysicsTS(withInput({ zFromFocusLookup_um: 9999 }));
    mock.ctx.resetStats();
    renderer.setOptions({
      visibleContours: { ...DEFAULT_ISOFLUENCE_VISIBILITY },
      zFromFocusLookup_um: 9999,
    });
    renderer.setOutput(outFar);
    assertAllDrawArgsFinite(mock.ctx);

    const tbl = JSON.stringify(renderer.getSummaryTable());
    expect(tbl).toContain('No ablation');
    expect(tbl).not.toContain('NaN');
    expect(tbl).not.toContain('undefined');

    // Explicit ablatedSpotAtLookupZ_um === 0 must report 'status' unit alongside 'No ablation'
    const zeroSpotOut = {
      ...out,
      scalars: {
        ...out.scalars,
        ablatedSpotAtLookupZ_um: 0,
      },
    };
    renderer.setOutput(zeroSpotOut);
    const spotRow = renderer
      .getSummaryTable()
      .rows.find((row) => row[0] === 'Ablated Spot ⌀ at Z');
    expect(spotRow).toEqual(['Ablated Spot ⌀ at Z', 'No ablation', 'status']);
    renderer.destroy();
  });
});

describe('Tab 4 — FluenceCanvasRenderer (Chart 6)', () => {
  it('switches Normalized vs J/cm² units and handles F_th = 0.99 * F_0 and F_th >= F_0', () => {
    const defOut = DEFAULT_OUTPUT;
    const mock = createMockCanvas(640, 440);
    const renderer = new FluenceCanvasRenderer(mock.canvas);
    renderer.setOutput(defOut);
    assertAllDrawArgsFinite(mock.ctx);

    const normTable = JSON.stringify(renderer.getSummaryTable());
    expect(normTable).not.toContain('NaN');
    expect(normTable).not.toContain('undefined');

    mock.ctx.resetStats();
    renderer.setUnitMode('fluence');
    assertAllDrawArgsFinite(mock.ctx);
    const jcmTable = JSON.stringify(renderer.getSummaryTable());
    expect(jcmTable).not.toBe(normTable);
    expect(jcmTable).toContain('190.');

    // Narrow tip: F_th = 0.99 * F_0 -> 188.1 J/cm² (default F_0 = 190.02 J/cm²)
    const narrowOut = computePhysicsTS(
      withInput({ ablationThreshOverride_J_cm2: 188.1 }),
    );
    const narrowGeom = computeFluenceSplitGeometry(narrowOut, 'fluence');
    expect(narrowGeom.hasAblation).toBe(true);
    expect(narrowGeom.rThNorm).toBeGreaterThan(0);
    expect(narrowGeom.rThNorm).toBeLessThan(0.15);

    mock.ctx.resetStats();
    renderer.setOutput(narrowOut);
    assertAllDrawArgsFinite(mock.ctx);

    // Below threshold: F_th >= F_0 -> all No-Ablation in both modes
    const belowOut = computePhysicsTS(
      withInput({ ablationThreshOverride_J_cm2: 300 }),
    );
    const belowGeom = computeFluenceSplitGeometry(belowOut, 'normalized');
    expect(belowGeom.hasAblation).toBe(false);

    for (const mode of ['normalized', 'fluence'] as const) {
      mock.ctx.resetStats();
      renderer.setUnitMode(mode);
      renderer.setOutput(belowOut);
      assertAllDrawArgsFinite(mock.ctx);
    }

    const belowTable = JSON.stringify(renderer.getSummaryTable());
    expect(belowTable).toContain('No ablation');
    expect(belowTable).not.toContain('NaN');
    expect(belowTable).not.toContain('undefined');
    renderer.destroy();
  });

  it('refits Y scale when toggling unitMode after wheel zoom and plots non-collapsed Gaussian when w0_um <= 0', () => {
    const defOut = DEFAULT_OUTPUT;
    const mock = createMockCanvas(640, 440);
    const renderer = new FluenceCanvasRenderer(mock.canvas);
    renderer.setOutput(defOut);

    // Wheel zoom in normalized mode (sets hasUserTransformed = true)
    mock.dispatch('wheel', { clientX: 320, clientY: 220, deltaY: -120, deltaMode: 0 });
    const vpNormZoomed = renderer.getViewportState();

    // Switching to 'fluence' must rescale scaleY and place Peak Fluence inside [0, 440]
    mock.ctx.resetStats();
    renderer.setUnitMode('fluence');
    const vpFluence = renderer.getViewportState();
    expect(vpFluence.scaleY).toBeLessThan(vpNormZoomed.scaleY * 0.1);
    const peakSc = worldToScreen(vpFluence, 0, defOut.scalars.peakFluence_J_cm2);
    expect(peakSc.y).toBeGreaterThan(0);
    expect(peakSc.y).toBeLessThan(440);
    assertAllDrawArgsFinite(mock.ctx);

    // Wheel zoom in fluence mode, then switch back to normalized -> peak 1.0 stays inside [0, 440]
    mock.dispatch('wheel', { clientX: 320, clientY: 220, deltaY: 180, deltaMode: 0 });
    renderer.setUnitMode('normalized');
    const vpNorm = renderer.getViewportState();
    const normPeakSc = worldToScreen(vpNorm, 0, 1);
    expect(normPeakSc.y).toBeGreaterThan(0);
    expect(normPeakSc.y).toBeLessThan(440);

    // Degenerate w0_um <= 0: focusDist r_um is all 0, curve must still plot across [-3, +3]
    const zeroW0Dist = new Float64Array(defOut.focusDist);
    for (let i = 0; i < 601; i++) {
      zeroW0Dist[i * 5] = 0; // DIST_COL.R_UM = 0
    }
    const zeroW0Out = {
      ...defOut,
      scalars: {
        ...defOut.scalars,
        w0_um: 0,
      },
      focusDist: zeroW0Dist,
    };

    renderer.setOutput(zeroW0Out);
    mock.ctx.resetStats();
    renderer.resetView();
    assertAllDrawArgsFinite(mock.ctx);
    const curveXs = mock.ctx.recordedPoints
      .filter((pt) => pt.lineWidth === 2.5)
      .map((pt) => pt.x);
    expect(curveXs.length).toBeGreaterThanOrEqual(600);
    expect(Math.min(...curveXs)).toBeLessThan(150);
    expect(Math.max(...curveXs)).toBeGreaterThan(490);
    renderer.destroy();
  });
});
