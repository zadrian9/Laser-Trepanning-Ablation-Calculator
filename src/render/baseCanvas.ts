/**
 * Shared High-DPI Interactive Canvas Infrastructure (M3).
 * Provides pure viewport math, ResizeObserver integer-DPR sizing with 0x0 hidden-tab
 * protection, Pointer Events (1-pointer pan, 2-pointer pinch-zoom, wheel zoom, crosshair),
 * theme palette sync, PNG export via canvas.toBlob(), and zero-innerHTML DOM summary tables.
 */

export interface Point2D {
  x: number;
  y: number;
}

export interface WorldBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export interface ViewportPadding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface ViewportOptions {
  lockAspect: boolean;
  invertY: boolean;
  padding?: ViewportPadding;
  minZoomFactor?: number;
  maxZoomFactor?: number;
}

export interface ViewportState {
  offsetX: number;
  offsetY: number;
  scaleX: number;
  scaleY: number;
  baseScaleX: number;
  baseScaleY: number;
  invertY: boolean;
  lockAspect: boolean;
  minZoomFactor: number;
  maxZoomFactor: number;
}

export type ThemeMode = 'dark' | 'light';

export interface ThemePalette {
  mode: ThemeMode;
  bg: string;
  surface: string;
  grid: string;
  gridMajor: string;
  axis: string;
  text: string;
  textBright: string;
  pillBg: string;
  pillBorder: string;
  crosshair: string;
  beamWaist: string;
  beamWaistFill: string;
  ghostBeamWaist: string;
  ghostBeamFill: string;
  ablation: string;
  ablationFill: string;
  ghostAblation: string;
  ghostAblationFill: string;
  noAblation: string;
  noAblationFill: string;
  holeEntrance: string;
  holeExit: string;
  holeWall: string;
  nozzleFill: string;
  nozzleStroke: string;
  nozzleAperture: string;
  clipping: string;
  overcut: string;
  safe: string;
  warning: string;
  accent: string;
  thermalDamage: string;
  opticalAxis: string;
  isoLevels: readonly string[];
  sliceColors: readonly string[];
}

export interface SummaryTableSpec {
  caption: string;
  headers: readonly string[];
  rows: readonly (readonly string[])[];
}

export interface CrosshairReadout {
  screenX: number;
  screenY: number;
  worldX: number;
  worldY: number;
  labelX: string;
  labelY: string;
}

export interface BaseCanvasConfig {
  defaultTheme?: ThemeMode;
  onCrosshairChange?: (readout: CrosshairReadout | null) => void;
  rootElement?: Element | null;
}

export const DEFAULT_VIEWPORT_PADDING: Readonly<ViewportPadding> = {
  top: 28,
  right: 24,
  bottom: 40,
  left: 64,
};

export const DEFAULT_DARK_PALETTE: Readonly<ThemePalette> = {
  mode: 'dark',
  bg: '#0b1120',
  surface: 'rgba(30, 41, 59, 0.85)',
  grid: 'rgba(51, 65, 85, 0.42)',
  gridMajor: 'rgba(71, 85, 105, 0.72)',
  axis: '#64748b',
  text: '#94a3b8',
  textBright: '#f8fafc',
  pillBg: 'rgba(15, 23, 42, 0.92)',
  pillBorder: '#334155',
  crosshair: 'rgba(148, 163, 184, 0.65)',
  beamWaist: '#38bdf8',
  beamWaistFill: 'rgba(56, 189, 248, 0.14)',
  ghostBeamWaist: 'rgba(56, 189, 248, 0.28)',
  ghostBeamFill: 'rgba(56, 189, 248, 0.05)',
  ablation: '#ef4444',
  ablationFill: 'rgba(239, 68, 68, 0.28)',
  ghostAblation: 'rgba(239, 68, 68, 0.28)',
  ghostAblationFill: 'rgba(239, 68, 68, 0.06)',
  noAblation: '#64748b',
  noAblationFill: 'rgba(100, 116, 139, 0.28)',
  holeEntrance: '#a855f7',
  holeExit: '#c084fc',
  holeWall: '#a855f7',
  nozzleFill: 'rgba(71, 85, 105, 0.42)',
  nozzleStroke: '#64748b',
  nozzleAperture: '#38bdf8',
  clipping: '#ef4444',
  overcut: '#f59e0b',
  safe: '#10b981',
  warning: '#f59e0b',
  accent: '#06b6d4',
  thermalDamage: '#f97316',
  opticalAxis: 'rgba(226, 232, 240, 0.45)',
  isoLevels: [
    '#3b82f6',
    '#2563eb',
    '#0ea5e9',
    '#14b8a6',
    '#22c55e',
    '#eab308',
    '#f59e0b',
  ],
  sliceColors: [
    '#06b6d4',
    '#38bdf8',
    '#22c55e',
    '#eab308',
    '#f97316',
    '#ec4899',
  ],
};

export const DEFAULT_LIGHT_PALETTE: Readonly<ThemePalette> = {
  mode: 'light',
  bg: '#f8fafc',
  surface: 'rgba(226, 232, 240, 0.85)',
  grid: 'rgba(203, 213, 225, 0.72)',
  gridMajor: 'rgba(148, 163, 184, 0.85)',
  axis: '#475569',
  text: '#475569',
  textBright: '#0f172a',
  pillBg: 'rgba(255, 255, 255, 0.94)',
  pillBorder: '#cbd5e1',
  crosshair: 'rgba(51, 65, 85, 0.55)',
  beamWaist: '#0284c7',
  beamWaistFill: 'rgba(14, 165, 233, 0.16)',
  ghostBeamWaist: 'rgba(14, 165, 233, 0.30)',
  ghostBeamFill: 'rgba(14, 165, 233, 0.06)',
  ablation: '#dc2626',
  ablationFill: 'rgba(220, 38, 38, 0.24)',
  ghostAblation: 'rgba(220, 38, 38, 0.26)',
  ghostAblationFill: 'rgba(220, 38, 38, 0.06)',
  noAblation: '#64748b',
  noAblationFill: 'rgba(100, 116, 139, 0.22)',
  holeEntrance: '#9333ea',
  holeExit: '#a855f7',
  holeWall: '#9333ea',
  nozzleFill: 'rgba(203, 213, 225, 0.65)',
  nozzleStroke: '#64748b',
  nozzleAperture: '#0284c7',
  clipping: '#dc2626',
  overcut: '#d97706',
  safe: '#16a34a',
  warning: '#d97706',
  accent: '#0891b2',
  thermalDamage: '#ea580c',
  opticalAxis: 'rgba(15, 23, 42, 0.38)',
  isoLevels: [
    '#2563eb',
    '#1d4ed8',
    '#0284c7',
    '#0d9488',
    '#16a34a',
    '#ca8a04',
    '#d97706',
  ],
  sliceColors: [
    '#0891b2',
    '#0284c7',
    '#16a34a',
    '#ca8a04',
    '#ea580c',
    '#db2777',
  ],
};

function readCssVar(style: CSSStyleDeclaration | null, name: string): string {
  if (!style) return '';
  return style.getPropertyValue(name).trim();
}

export function resolveThemePalette(
  theme: ThemeMode,
  rootEl?: Element | null,
): ThemePalette {
  const base = theme === 'light' ? DEFAULT_LIGHT_PALETTE : DEFAULT_DARK_PALETTE;
  const palette: ThemePalette = {
    ...base,
    isoLevels: [...base.isoLevels],
    sliceColors: [...base.sliceColors],
  };

  if (
    typeof getComputedStyle !== 'function' ||
    !rootEl ||
    typeof rootEl !== 'object'
  ) {
    return palette;
  }

  try {
    const cs = getComputedStyle(rootEl);
    const bg = readCssVar(cs, '--canvas-bg');
    const grid = readCssVar(cs, '--canvas-grid');
    const text = readCssVar(cs, '--canvas-text');
    const textBright = readCssVar(cs, '--canvas-text-bright');
    const accent = readCssVar(cs, '--canvas-accent');
    const surface = readCssVar(cs, '--canvas-surface');
    if (bg) palette.bg = bg;
    if (grid) palette.grid = grid;
    if (text) palette.text = text;
    if (textBright) palette.textBright = textBright;
    if (accent) palette.accent = accent;
    if (surface) palette.surface = surface;
  } catch {
    // Fallback cleanly to static theme palette in constrained environments
  }

  return palette;
}

export function formatNumberSafe(
  value: number,
  decimals = 2,
  fallback = '—',
): string {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  const normalized = Math.abs(value) < 1e-12 ? 0 : value;
  const fixed = normalized.toFixed(decimals);
  return fixed === '-0' || fixed === '-0.0' || /^-0\.0+$/.test(fixed)
    ? (0).toFixed(decimals)
    : fixed;
}

export function createDefaultViewport(
  options?: Partial<ViewportOptions>,
): ViewportState {
  return {
    offsetX: 0,
    offsetY: 0,
    scaleX: 1,
    scaleY: 1,
    baseScaleX: 1,
    baseScaleY: 1,
    invertY: options?.invertY ?? true,
    lockAspect: options?.lockAspect ?? true,
    minZoomFactor: options?.minZoomFactor ?? 0.1,
    maxZoomFactor: options?.maxZoomFactor ?? 50,
  };
}

export function expandBounds(
  autoBounds: WorldBounds,
  expansion?: Partial<WorldBounds> | null,
): WorldBounds {
  let minX = autoBounds.minX;
  let maxX = autoBounds.maxX;
  let minY = autoBounds.minY;
  let maxY = autoBounds.maxY;

  if (expansion) {
    const hasMinX = typeof expansion.minX === 'number' && Number.isFinite(expansion.minX);
    const hasMaxX = typeof expansion.maxX === 'number' && Number.isFinite(expansion.maxX);
    if (hasMinX && hasMaxX) {
      const lo = Math.min(expansion.minX!, expansion.maxX!);
      const hi = Math.max(expansion.minX!, expansion.maxX!);
      minX = Math.min(minX, lo);
      maxX = Math.max(maxX, hi);
    } else if (hasMinX) {
      minX = Math.min(minX, expansion.minX!);
      maxX = Math.max(maxX, expansion.minX!);
    } else if (hasMaxX) {
      minX = Math.min(minX, expansion.maxX!);
      maxX = Math.max(maxX, expansion.maxX!);
    }

    const hasMinY = typeof expansion.minY === 'number' && Number.isFinite(expansion.minY);
    const hasMaxY = typeof expansion.maxY === 'number' && Number.isFinite(expansion.maxY);
    if (hasMinY && hasMaxY) {
      const lo = Math.min(expansion.minY!, expansion.maxY!);
      const hi = Math.max(expansion.minY!, expansion.maxY!);
      minY = Math.min(minY, lo);
      maxY = Math.max(maxY, hi);
    } else if (hasMinY) {
      minY = Math.min(minY, expansion.minY!);
      maxY = Math.max(maxY, expansion.minY!);
    } else if (hasMaxY) {
      minY = Math.min(minY, expansion.maxY!);
      maxY = Math.max(maxY, expansion.maxY!);
    }
  }

  return { minX, maxX, minY, maxY };
}

export function fitBoundsToViewport(
  bounds: WorldBounds,
  width: number,
  height: number,
  options: ViewportOptions,
): ViewportState {
  const minZoomFactor = options.minZoomFactor ?? 0.1;
  const maxZoomFactor = options.maxZoomFactor ?? 50;

  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return createDefaultViewport(options);
  }

  let minX = Number.isFinite(bounds.minX) ? bounds.minX : -1;
  let maxX = Number.isFinite(bounds.maxX) ? bounds.maxX : 1;
  let minY = Number.isFinite(bounds.minY) ? bounds.minY : -1;
  let maxY = Number.isFinite(bounds.maxY) ? bounds.maxY : 1;

  if (minX > maxX) [minX, maxX] = [maxX, minX];
  if (minY > maxY) [minY, maxY] = [maxY, minY];

  if (maxX - minX < 1e-9) {
    minX -= 1;
    maxX += 1;
  }
  if (maxY - minY < 1e-9) {
    minY -= 1;
    maxY += 1;
  }

  const pad = options.padding ?? DEFAULT_VIEWPORT_PADDING;
  const usableW = Math.max(1, width - pad.left - pad.right);
  const usableH = Math.max(1, height - pad.top - pad.bottom);

  const spanX = maxX - minX;
  const spanY = maxY - minY;
  const rawScaleX = usableW / spanX;
  const rawScaleY = usableH / spanY;

  let scaleX = rawScaleX;
  let scaleY = rawScaleY;
  if (options.lockAspect) {
    const unified = Math.min(rawScaleX, rawScaleY);
    scaleX = unified;
    scaleY = unified;
  }

  const worldCx = (minX + maxX) / 2;
  const worldCy = (minY + maxY) / 2;
  const screenCx = pad.left + usableW / 2;
  const screenCy = pad.top + usableH / 2;

  const ySign = options.invertY ? -scaleY : scaleY;
  const offsetX = screenCx - worldCx * scaleX;
  const offsetY = screenCy - worldCy * ySign;

  return {
    offsetX,
    offsetY,
    scaleX,
    scaleY,
    baseScaleX: scaleX,
    baseScaleY: scaleY,
    invertY: options.invertY,
    lockAspect: options.lockAspect,
    minZoomFactor,
    maxZoomFactor,
  };
}

export function worldToScreen(
  state: ViewportState,
  wx: number,
  wy: number,
): Point2D {
  return {
    x: state.offsetX + wx * state.scaleX,
    y: state.offsetY + wy * (state.invertY ? -state.scaleY : state.scaleY),
  };
}

export function screenToWorld(
  state: ViewportState,
  sx: number,
  sy: number,
): Point2D {
  const sySigned = state.invertY ? -state.scaleY : state.scaleY;
  return {
    x: state.scaleX !== 0 ? (sx - state.offsetX) / state.scaleX : 0,
    y: sySigned !== 0 ? (sy - state.offsetY) / sySigned : 0,
  };
}

export function panViewport(
  state: ViewportState,
  dx: number,
  dy: number,
): ViewportState {
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) {
    return state;
  }
  return {
    ...state,
    offsetX: state.offsetX + dx,
    offsetY: state.offsetY + dy,
  };
}

function clampValue(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

export function zoomViewportAt(
  state: ViewportState,
  anchorX: number,
  anchorY: number,
  factorX: number,
  factorY = factorX,
): ViewportState {
  if (
    !Number.isFinite(anchorX) ||
    !Number.isFinite(anchorY) ||
    !Number.isFinite(factorX) ||
    !Number.isFinite(factorY) ||
    factorX <= 0 ||
    factorY <= 0 ||
    state.scaleX <= 0 ||
    state.scaleY <= 0
  ) {
    return state;
  }

  const minX = state.baseScaleX * state.minZoomFactor;
  const maxX = state.baseScaleX * state.maxZoomFactor;
  const nextScaleX = clampValue(state.scaleX * factorX, minX, maxX);

  let nextScaleY: number;
  if (state.lockAspect) {
    const ratio = nextScaleX / state.scaleX;
    nextScaleY = state.scaleY * ratio;
  } else {
    const minY = state.baseScaleY * state.minZoomFactor;
    const maxY = state.baseScaleY * state.maxZoomFactor;
    nextScaleY = clampValue(state.scaleY * factorY, minY, maxY);
  }

  const nextOffsetX =
    anchorX - (anchorX - state.offsetX) * (nextScaleX / state.scaleX);
  const nextOffsetY =
    anchorY - (anchorY - state.offsetY) * (nextScaleY / state.scaleY);

  return {
    ...state,
    offsetX: nextOffsetX,
    offsetY: nextOffsetY,
    scaleX: nextScaleX,
    scaleY: nextScaleY,
  };
}

export function pinchZoomViewport(
  state: ViewportState,
  p1Prev: Point2D,
  p2Prev: Point2D,
  p1Curr: Point2D,
  p2Curr: Point2D,
): ViewportState {
  const midPrevX = (p1Prev.x + p2Prev.x) / 2;
  const midPrevY = (p1Prev.y + p2Prev.y) / 2;
  const midCurrX = (p1Curr.x + p2Curr.x) / 2;
  const midCurrY = (p1Curr.y + p2Curr.y) / 2;

  const distPrev = Math.hypot(p2Prev.x - p1Prev.x, p2Prev.y - p1Prev.y);
  const distCurr = Math.hypot(p2Curr.x - p1Curr.x, p2Curr.y - p1Curr.y);

  if (
    !Number.isFinite(distPrev) ||
    !Number.isFinite(distCurr) ||
    distPrev < 1e-3 ||
    distCurr < 1e-3
  ) {
    return panViewport(state, midCurrX - midPrevX, midCurrY - midPrevY);
  }

  const worldAtMidPrev = screenToWorld(state, midPrevX, midPrevY);
  const zoomed = zoomViewportAt(state, midPrevX, midPrevY, distCurr / distPrev);
  const ySigned = zoomed.invertY ? -zoomed.scaleY : zoomed.scaleY;

  return {
    ...zoomed,
    offsetX: midCurrX - worldAtMidPrev.x * zoomed.scaleX,
    offsetY: midCurrY - worldAtMidPrev.y * ySigned,
  };
}

export function computeNiceTicks(
  minVal: number,
  maxVal: number,
  pixelSpan: number,
  targetStepPx = 80,
): { step: number; ticks: number[] } {
  if (
    !Number.isFinite(minVal) ||
    !Number.isFinite(maxVal) ||
    !Number.isFinite(pixelSpan) ||
    pixelSpan <= 0 ||
    targetStepPx <= 0
  ) {
    return { step: 1, ticks: [] };
  }

  const lo = Math.min(minVal, maxVal);
  const hi = Math.max(minVal, maxVal);
  const span = hi - lo;
  if (span <= 0) {
    return { step: 1, ticks: [lo] };
  }

  const approxTicks = Math.max(1, pixelSpan / targetStepPx);
  const rawStep = span / approxTicks;
  const pow10 = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const norm = rawStep / pow10;

  let niceFactor: number;
  if (norm <= 1) niceFactor = 1;
  else if (norm <= 2) niceFactor = 2;
  else if (norm <= 5) niceFactor = 5;
  else niceFactor = 10;

  const step = niceFactor * pow10;
  if (!Number.isFinite(step) || step <= 0) {
    return { step: 1, ticks: [] };
  }

  const firstIdx = Math.ceil(lo / step - 1e-9);
  const lastIdx = Math.floor(hi / step + 1e-9);
  const count = Math.min(200, Math.max(0, lastIdx - firstIdx + 1));

  const ticks: number[] = [];
  for (let i = 0; i < count; i++) {
    const raw = (firstIdx + i) * step;
    const clean = Math.abs(raw) < step * 1e-9 ? 0 : Number(raw.toPrecision(10));
    ticks.push(clean);
  }
  return { step, ticks };
}

/**
 * Strokes contiguous finite segments of a polyline, breaking cleanly whenever
 * a point is null or has non-finite (NaN / Infinity) coordinates.
 * Returns the number of contiguous multi-point segments drawn.
 */
export function strokePolylineWithNaNBreaks(
  ctx: CanvasRenderingContext2D,
  count: number,
  getScreenPoint: (index: number) => Point2D | null,
): number {
  let segments = 0;
  let activeLen = 0;
  let pendingFirst: Point2D | null = null;

  const flushStroke = () => {
    if (activeLen >= 2) {
      ctx.stroke();
      segments++;
    }
    activeLen = 0;
    pendingFirst = null;
  };

  for (let i = 0; i < count; i++) {
    const pt = getScreenPoint(i);
    if (!pt || !Number.isFinite(pt.x) || !Number.isFinite(pt.y)) {
      flushStroke();
      continue;
    }

    if (activeLen === 0) {
      pendingFirst = pt;
      activeLen = 1;
    } else if (activeLen === 1 && pendingFirst) {
      ctx.beginPath();
      ctx.moveTo(pendingFirst.x, pendingFirst.y);
      ctx.lineTo(pt.x, pt.y);
      activeLen = 2;
      pendingFirst = null;
    } else {
      ctx.lineTo(pt.x, pt.y);
      activeLen++;
    }
  }

  flushStroke();
  return segments;
}

/**
 * Strokes a closed loop when points are contiguous finite, or breaks into open
 * NaN-safe polylines if gaps exist.
 */
export function strokeLoopWithNaNBreaks(
  ctx: CanvasRenderingContext2D,
  count: number,
  getScreenPoint: (index: number) => Point2D | null,
): number {
  let firstPt: Point2D | null = null;
  let allFinite = count >= 3;
  if (allFinite) {
    ctx.beginPath();
    for (let i = 0; i < count; i++) {
      const pt = getScreenPoint(i);
      if (!pt || !Number.isFinite(pt.x) || !Number.isFinite(pt.y)) {
        allFinite = false;
        break;
      }
      if (i === 0) {
        firstPt = pt;
        ctx.moveTo(pt.x, pt.y);
      } else {
        ctx.lineTo(pt.x, pt.y);
      }
    }
    if (allFinite && firstPt) {
      ctx.closePath();
      ctx.stroke();
      return 1;
    }
  }
  return strokePolylineWithNaNBreaks(ctx, count, getScreenPoint);
}

function appendChildSafe(parent: Node, child: Node): void {
  parent.appendChild(child);
}

function replaceChildrenSafe(parent: Element, child: Node): void {
  const maybeReplace = (parent as { replaceChildren?: (...nodes: Node[]) => void })
    .replaceChildren;
  if (typeof maybeReplace === 'function') {
    maybeReplace.call(parent, child);
  } else {
    while (parent.firstChild) {
      parent.removeChild(parent.firstChild);
    }
    parent.appendChild(child);
  }
}

export function buildSummaryTableElement(
  spec: SummaryTableSpec,
  doc: Document | undefined = typeof document !== 'undefined' ? document : undefined,
): HTMLTableElement {
  if (!doc) {
    throw new Error('Document is required to build a summary table element.');
  }

  const table = doc.createElement('table');
  table.className = 'summary-data-table';

  const caption = doc.createElement('caption');
  caption.textContent = spec.caption;
  appendChildSafe(table, caption);

  const thead = doc.createElement('thead');
  const headerRow = doc.createElement('tr');
  for (const heading of spec.headers) {
    const th = doc.createElement('th');
    th.setAttribute('scope', 'col');
    th.textContent = heading;
    appendChildSafe(headerRow, th);
  }
  appendChildSafe(thead, headerRow);
  appendChildSafe(table, thead);

  const tbody = doc.createElement('tbody');
  for (const rowCells of spec.rows) {
    const tr = doc.createElement('tr');
    for (let c = 0; c < rowCells.length; c++) {
      const cell = doc.createElement(c === 0 ? 'th' : 'td');
      if (c === 0) {
        cell.setAttribute('scope', 'row');
      }
      cell.textContent = rowCells[c];
      appendChildSafe(tr, cell);
    }
    appendChildSafe(tbody, tr);
  }
  appendChildSafe(table, tbody);

  return table;
}

export abstract class BaseInteractiveCanvas<TData = unknown> {
  protected readonly canvas: HTMLCanvasElement;
  protected readonly ctx: CanvasRenderingContext2D;
  protected theme: ThemeMode;
  protected palette: ThemePalette;
  protected viewport: ViewportState;
  protected data: TData | null = null;
  protected cssWidth = 0;
  protected cssHeight = 0;
  protected dpr = 1;
  protected hoverScreen: Point2D | null = null;
  protected hasUserTransformed = false;
  protected hasFittedOnce = false;
  protected isVisible = true;

  private readonly config: BaseCanvasConfig;
  private readonly activePointers = new Map<number, Point2D>();
  private resizeObserver: ResizeObserver | null = null;
  private pendingRafId: number | null = null;
  private destroyed = false;

  private readonly onPointerDownBound: (e: PointerEvent) => void;
  private readonly onPointerMoveBound: (e: PointerEvent) => void;
  private readonly onPointerUpOrCancelBound: (e: PointerEvent) => void;
  private readonly onPointerLeaveBound: (e: PointerEvent) => void;
  private readonly onWheelBound: (e: WheelEvent) => void;

  constructor(canvas: HTMLCanvasElement, config: BaseCanvasConfig = {}) {
    this.canvas = canvas;
    this.config = config;

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('2D canvas rendering context is unavailable.');
    }
    this.ctx = ctx;

    if (canvas.style) {
      canvas.style.touchAction = 'none';
    }

    this.theme = config.defaultTheme ?? this.detectInitialTheme();
    this.palette = resolveThemePalette(this.theme, this.getRootElement());
    this.viewport = createDefaultViewport(this.getViewportOptions());

    this.onPointerDownBound = (e) => this.handlePointerDown(e);
    this.onPointerMoveBound = (e) => this.handlePointerMove(e);
    this.onPointerUpOrCancelBound = (e) => this.handlePointerUpOrCancel(e);
    this.onPointerLeaveBound = () => this.handlePointerLeave();
    this.onWheelBound = (e) => this.handleWheel(e);

    this.bindEvents();
    this.resize();
  }

  private detectInitialTheme(): ThemeMode {
    const root = this.getRootElement();
    const attr = root?.getAttribute?.('data-theme');
    return attr === 'light' ? 'light' : 'dark';
  }

  private getRootElement(): Element | null {
    if (this.config.rootElement !== undefined) {
      return this.config.rootElement;
    }
    if (typeof document !== 'undefined') {
      return document.documentElement;
    }
    return null;
  }

  private getDevicePixelRatio(): number {
    if (
      typeof window !== 'undefined' &&
      Number.isFinite(window.devicePixelRatio) &&
      window.devicePixelRatio > 0
    ) {
      return window.devicePixelRatio;
    }
    return 1;
  }

  private bindEvents(): void {
    const add = this.canvas.addEventListener?.bind(this.canvas);
    if (add) {
      add('pointerdown', this.onPointerDownBound as EventListener);
      add('pointermove', this.onPointerMoveBound as EventListener);
      add('pointerup', this.onPointerUpOrCancelBound as EventListener);
      add('pointercancel', this.onPointerUpOrCancelBound as EventListener);
      add('pointerleave', this.onPointerLeaveBound as EventListener);
      add('wheel', this.onWheelBound as EventListener, { passive: false });
    }

    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver((entries) => {
        if (this.destroyed) return;
        const entry = entries[0];
        if (!entry) {
          this.resize();
          return;
        }
        const dpBox = (
          entry as ResizeObserverEntry & {
            devicePixelContentBoxSize?: ReadonlyArray<ResizeObserverSize>;
          }
        ).devicePixelContentBoxSize?.[0];
        const rect = entry.contentRect;
        if (dpBox && rect && rect.width > 0 && rect.height > 0) {
          this.applySize(rect.width, rect.height, dpBox.inlineSize, dpBox.blockSize);
        } else {
          this.resize();
        }
      });
      try {
        this.resizeObserver.observe(this.canvas);
      } catch {
        // Ignore if mock element cannot be observed by native ResizeObserver
      }
    }
  }

  resize(): boolean {
    if (this.destroyed) return false;
    const rect = this.canvas.getBoundingClientRect?.();
    let cssW: number;
    let cssH: number;

    if (rect !== undefined && rect !== null) {
      cssW = rect.width;
      cssH = rect.height;
    } else if (this.canvas.parentElement?.getBoundingClientRect) {
      const parentRect = this.canvas.parentElement.getBoundingClientRect();
      cssW = parentRect?.width ?? 0;
      cssH = parentRect?.height ?? 0;
    } else {
      cssW = 0;
      cssH = 0;
    }

    if (!Number.isFinite(cssW) || !Number.isFinite(cssH) || cssW <= 0 || cssH <= 0) {
      return false;
    }

    const dpr = this.getDevicePixelRatio();
    return this.applySize(
      cssW,
      cssH,
      Math.max(1, Math.round(cssW * dpr)),
      Math.max(1, Math.round(cssH * dpr)),
    );
  }

  private applySize(
    cssW: number,
    cssH: number,
    pixelW: number,
    pixelH: number,
  ): boolean {
    if (
      !Number.isFinite(cssW) ||
      !Number.isFinite(cssH) ||
      cssW <= 0 ||
      cssH <= 0
    ) {
      return false;
    }

    const dpr = this.getDevicePixelRatio();
    const targetW = Math.max(1, Math.round(pixelW));
    const targetH = Math.max(1, Math.round(pixelH));

    if (this.canvas.width !== targetW) {
      this.canvas.width = targetW;
    }
    if (this.canvas.height !== targetH) {
      this.canvas.height = targetH;
    }

    this.cssWidth = cssW;
    this.cssHeight = cssH;
    this.dpr = dpr;

    if (this.data && (!this.hasFittedOnce || !this.hasUserTransformed)) {
      this.fitToBounds();
    }

    this.render();
    return true;
  }

  setVisible(visible: boolean): void {
    this.isVisible = visible;
    if (visible) {
      this.resize();
    }
  }

  setTheme(theme: ThemeMode): void {
    this.theme = theme;
    this.palette = resolveThemePalette(theme, this.getRootElement());
    this.render();
  }

  getTheme(): ThemeMode {
    return this.theme;
  }

  getViewportState(): ViewportState {
    return { ...this.viewport };
  }

  setData(data: TData): void {
    const prev = this.data;
    this.data = data;

    const forceRefit = this.shouldForceRefitOnDataChange(prev, data);
    if (forceRefit) {
      this.hasUserTransformed = false;
      this.hasFittedOnce = false;
      this.viewport = createDefaultViewport(this.getViewportOptions());
    }

    if (this.cssWidth > 0 && this.cssHeight > 0) {
      if (
        forceRefit ||
        !this.hasFittedOnce ||
        (!this.hasUserTransformed && this.shouldRefitOnDataChange(prev, data))
      ) {
        this.fitToBounds();
      }
    }

    this.requestRender();
  }

  protected shouldForceRefitOnDataChange(_prev: TData | null, _next: TData): boolean {
    return false;
  }

  protected shouldRefitOnDataChange(_prev: TData | null, _next: TData): boolean {
    return false;
  }

  fitToBounds(): void {
    if (!this.data || this.cssWidth <= 0 || this.cssHeight <= 0) return;
    this.viewport = fitBoundsToViewport(
      this.getAutoBounds(this.data),
      this.cssWidth,
      this.cssHeight,
      this.getViewportOptions(),
    );
    this.hasFittedOnce = true;
  }

  resetView(): void {
    this.hasUserTransformed = false;
    this.hasFittedOnce = false;
    this.viewport = createDefaultViewport(this.getViewportOptions());
    if (this.data && this.cssWidth > 0 && this.cssHeight > 0) {
      this.fitToBounds();
    }
    this.render();
  }

  requestRender(): void {
    if (this.destroyed) return;
    if (typeof requestAnimationFrame === 'function') {
      if (this.pendingRafId !== null) return;
      this.pendingRafId = requestAnimationFrame(() => {
        this.pendingRafId = null;
        if (!this.destroyed) {
          this.render();
        }
      });
    } else {
      this.render();
    }
  }

  render(): void {
    if (this.destroyed) return;
    if (this.cssWidth <= 0 || this.cssHeight <= 0) {
      return;
    }

    const ctx = this.ctx;
    const scaleX = this.canvas.width / this.cssWidth;
    const scaleY = this.canvas.height / this.cssHeight;

    ctx.save();
    if (typeof ctx.setTransform === 'function') {
      ctx.setTransform(scaleX, 0, 0, scaleY, 0, 0);
    } else if (typeof ctx.resetTransform === 'function') {
      ctx.resetTransform();
      ctx.scale(scaleX, scaleY);
    }

    ctx.fillStyle = this.palette.bg;
    ctx.fillRect(0, 0, this.cssWidth, this.cssHeight);

    if (this.data) {
      this.draw(ctx, this.cssWidth, this.cssHeight, this.palette);

      if (this.hoverScreen && this.isVisible) {
        const world = screenToWorld(
          this.viewport,
          this.hoverScreen.x,
          this.hoverScreen.y,
        );
        const { labelX, labelY } = this.formatCrosshair(world.x, world.y);
        const readout: CrosshairReadout = {
          screenX: this.hoverScreen.x,
          screenY: this.hoverScreen.y,
          worldX: world.x,
          worldY: world.y,
          labelX,
          labelY,
        };
        this.drawCrosshair(ctx, this.cssWidth, this.cssHeight, readout);
      }
    }

    ctx.restore();
  }

  async exportPNG(filename = 'laser-trepanning-chart.png'): Promise<boolean> {
    if (this.cssWidth <= 0 || this.cssHeight <= 0) {
      this.resize();
    }
    this.render();

    const toBlob = this.canvas.toBlob?.bind(this.canvas);
    if (!toBlob) {
      return false;
    }

    const blob = await new Promise<Blob | null>((resolve) => {
      try {
        toBlob((result) => resolve(result), 'image/png');
      } catch {
        resolve(null);
      }
    });

    if (!blob) return false;

    if (
      typeof document !== 'undefined' &&
      typeof URL !== 'undefined' &&
      typeof URL.createObjectURL === 'function'
    ) {
      const url = URL.createObjectURL(blob);
      try {
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = filename;
        anchor.style.display = 'none';
        document.body?.appendChild(anchor);
        anchor.click();
        anchor.remove();
      } finally {
        if (typeof URL.revokeObjectURL === 'function') {
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        }
      }
    }

    return true;
  }

  renderSummaryTable(container: HTMLElement): HTMLTableElement {
    const doc =
      container.ownerDocument ??
      (typeof document !== 'undefined' ? document : undefined);
    const table = buildSummaryTableElement(this.getSummaryTable(), doc);
    replaceChildrenSafe(container, table);
    return table;
  }

  destroy(): void {
    this.destroyed = true;
    this.activePointers.clear();
    if (this.pendingRafId !== null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(this.pendingRafId);
      this.pendingRafId = null;
    }
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
    const remove = this.canvas.removeEventListener?.bind(this.canvas);
    if (remove) {
      remove('pointerdown', this.onPointerDownBound as EventListener);
      remove('pointermove', this.onPointerMoveBound as EventListener);
      remove('pointerup', this.onPointerUpOrCancelBound as EventListener);
      remove('pointercancel', this.onPointerUpOrCancelBound as EventListener);
      remove('pointerleave', this.onPointerLeaveBound as EventListener);
      remove('wheel', this.onWheelBound as EventListener);
    }
  }

  private getLocalPoint(clientX: number, clientY: number): Point2D {
    const rect = this.canvas.getBoundingClientRect?.();
    if (!rect) {
      return { x: clientX, y: clientY };
    }
    return {
      x: clientX - rect.left,
      y: clientY - rect.top,
    };
  }

  private emitCrosshair(screenPt: Point2D | null): void {
    if (!this.config.onCrosshairChange) return;
    if (!screenPt || !this.data) {
      this.config.onCrosshairChange(null);
      return;
    }
    const world = screenToWorld(this.viewport, screenPt.x, screenPt.y);
    const { labelX, labelY } = this.formatCrosshair(world.x, world.y);
    this.config.onCrosshairChange({
      screenX: screenPt.x,
      screenY: screenPt.y,
      worldX: world.x,
      worldY: world.y,
      labelX,
      labelY,
    });
  }

  private handlePointerDown(e: PointerEvent): void {
    if (e.button !== undefined && e.button !== 0 && e.pointerType === 'mouse') {
      return;
    }
    const pt = this.getLocalPoint(e.clientX, e.clientY);
    this.activePointers.set(e.pointerId, pt);
    this.hoverScreen = pt;

    try {
      this.canvas.setPointerCapture?.(e.pointerId);
    } catch {
      // Ignore capture failures on synthetic/mock events
    }

    if (this.canvas.style) {
      this.canvas.style.cursor = 'grabbing';
    }
    this.emitCrosshair(pt);
  }

  private handlePointerMove(e: PointerEvent): void {
    const curr = this.getLocalPoint(e.clientX, e.clientY);
    this.hoverScreen = curr;

    if (this.activePointers.size === 1 && this.activePointers.has(e.pointerId)) {
      const prev = this.activePointers.get(e.pointerId)!;
      const dx = curr.x - prev.x;
      const dy = curr.y - prev.y;
      if (dx !== 0 || dy !== 0) {
        this.viewport = panViewport(this.viewport, dx, dy);
        this.hasUserTransformed = true;
      }
      this.activePointers.set(e.pointerId, curr);
    } else if (this.activePointers.size >= 2 && this.activePointers.has(e.pointerId)) {
      let otherId: number | null = null;
      let otherPt: Point2D | null = null;
      for (const [id, pt] of this.activePointers.entries()) {
        if (id !== e.pointerId) {
          otherId = id;
          otherPt = pt;
          break;
        }
      }
      const prev = this.activePointers.get(e.pointerId)!;
      if (otherId !== null && otherPt) {
        this.viewport = pinchZoomViewport(
          this.viewport,
          prev,
          otherPt,
          curr,
          otherPt,
        );
        this.hasUserTransformed = true;
      }
      this.activePointers.set(e.pointerId, curr);
    }

    this.emitCrosshair(curr);
    this.requestRender();
  }

  private handlePointerUpOrCancel(e: PointerEvent): void {
    this.activePointers.delete(e.pointerId);
    try {
      this.canvas.releasePointerCapture?.(e.pointerId);
    } catch {
      // Ignore release failures on synthetic/mock events
    }

    if (this.activePointers.size === 0 && this.canvas.style) {
      this.canvas.style.cursor = 'crosshair';
    }

    if (e.type === 'pointercancel') {
      this.hoverScreen = null;
      this.emitCrosshair(null);
      this.requestRender();
    }
  }

  private handlePointerLeave(): void {
    if (this.activePointers.size > 0) return;
    this.hoverScreen = null;
    this.emitCrosshair(null);
    this.requestRender();
  }

  private handleWheel(e: WheelEvent): void {
    e.preventDefault?.();
    const anchor = this.getLocalPoint(e.clientX, e.clientY);
    const scaleUnit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
    const dy = e.deltaY * scaleUnit;
    const factor = Math.exp(-dy * 0.0015);
    if (!Number.isFinite(factor) || factor <= 0) return;

    this.viewport = zoomViewportAt(this.viewport, anchor.x, anchor.y, factor);
    this.hasUserTransformed = true;
    this.hoverScreen = anchor;
    this.emitCrosshair(anchor);
    this.requestRender();
  }

  protected formatCrosshair(
    worldX: number,
    worldY: number,
  ): { labelX: string; labelY: string } {
    return {
      labelX: `X: ${formatNumberSafe(worldX, 1)}`,
      labelY: `Y: ${formatNumberSafe(worldY, 1)}`,
    };
  }

  protected drawCrosshair(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    readout: CrosshairReadout,
  ): void {
    if (
      readout.screenX < 0 ||
      readout.screenX > width ||
      readout.screenY < 0 ||
      readout.screenY > height
    ) {
      return;
    }

    ctx.save();
    ctx.strokeStyle = this.palette.crosshair;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(readout.screenX, 0);
    ctx.lineTo(readout.screenX, height);
    ctx.moveTo(0, readout.screenY);
    ctx.lineTo(width, readout.screenY);
    ctx.stroke();
    ctx.setLineDash([]);

    const text = `${readout.labelX}  ${readout.labelY}`;
    ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, monospace';
    const textW = ctx.measureText?.(text)?.width ?? text.length * 6.8;
    const pillW = textW + 14;
    const pillH = 22;
    const margin = 8;

    let pillX = readout.screenX + 12;
    let pillY = readout.screenY - pillH - 10;
    if (pillX + pillW > width - margin) {
      pillX = readout.screenX - pillW - 12;
    }
    if (pillX < margin) {
      pillX = margin;
    }
    if (pillY < margin) {
      pillY = readout.screenY + 12;
    }
    if (pillY + pillH > height - margin) {
      pillY = Math.max(margin, height - pillH - margin);
    }

    ctx.fillStyle = this.palette.pillBg;
    ctx.strokeStyle = this.palette.pillBorder;
    ctx.lineWidth = 1;
    ctx.fillRect(pillX, pillY, pillW, pillH);
    ctx.strokeRect(pillX, pillY, pillW, pillH);

    ctx.fillStyle = this.palette.textBright;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, pillX + 7, pillY + pillH / 2);
    ctx.restore();
  }

  abstract getSummaryTable(): SummaryTableSpec;
  protected abstract getViewportOptions(): ViewportOptions;
  protected abstract getAutoBounds(data: TData): WorldBounds;
  protected abstract draw(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    palette: ThemePalette,
  ): void;
}
