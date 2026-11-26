/**
 * Tab 2 — Charts 3, 4, 5: Multi-Plane 3D Path & Contours Canvas Renderer
 * + 101-State Transition Mode Safety Heatmap Strip (`renderSafetyHeatmap`).
 */

import {
  CONTOUR_STEPS,
  PATH_STEPS,
  PLANE_INDEX,
  SWEEP_STATES,
  SWEEP_STRIDE,
  type HoleType,
  type PhysicsOutput,
} from '../types/physics.ts';
import {
  BaseInteractiveCanvas,
  computeNiceTicks,
  formatNumberSafe,
  screenToWorld,
  strokeLoopWithNaNBreaks,
  worldToScreen,
  type BaseCanvasConfig,
  type Point2D,
  type SummaryTableSpec,
  type ThemeMode,
  type ThemePalette,
  type ViewportOptions,
  type WorldBounds,
} from './baseCanvas.ts';

export type TopDownMode = 'beam_path' | 'contour_1e2' | 'contour_ablation' | 'all';

export interface TopDownRenderOptions {
  mode: TopDownMode;
  holeType: HoleType;
  showNozzleRings: boolean;
  orbitIndex: number;
  visiblePlanes?: readonly boolean[];
}

export interface TopDownCanvasData {
  output: PhysicsOutput;
  options: TopDownRenderOptions;
}

export type SafetyStatus = 'safe' | 'overcut' | 'clipping';

export interface SafetyHeatmapCell {
  progressPct: number;
  status: SafetyStatus;
  clipping: boolean;
  wallOvercut: boolean;
  maxOvercut_um: number;
  color: string;
}

const SLICE_PLANE_INDICES = [
  PLANE_INDEX.FOCUS,
  PLANE_INDEX.TOP,
  PLANE_INDEX.TOP_25,
  PLANE_INDEX.TOP_50,
  PLANE_INDEX.TOP_75,
  PLANE_INDEX.BOTTOM,
] as const;

const PLANE_LABELS = [
  'Exit Aperture 1',
  'Exit Aperture 2',
  'Focus',
  'Top Surface',
  'Top -25%',
  'Top -50%',
  'Top -75%',
  'Bottom',
] as const;

export function createDefaultTopDownOptions(): TopDownRenderOptions {
  return {
    mode: 'all',
    holeType: 'round',
    showNozzleRings: true,
    orbitIndex: 0,
  };
}

export function orbitDegreesToIndex(deg: number): number {
  if (!Number.isFinite(deg)) return 0;
  if (deg === 360) return CONTOUR_STEPS - 1; // 2000
  const wrapped = ((deg % 360) + 360) % 360;
  return Math.round((wrapped / 360) * (CONTOUR_STEPS - 1));
}

export function classifySafetyState(
  clipping: number | boolean,
  wallOvercut: number | boolean,
): SafetyStatus {
  const isClip = typeof clipping === 'boolean' ? clipping : clipping >= 0.5;
  const isOver = typeof wallOvercut === 'boolean' ? wallOvercut : wallOvercut >= 0.5;
  if (isClip) return 'clipping';
  if (isOver) return 'overcut';
  return 'safe';
}

function safetyColorForStatus(status: SafetyStatus, theme: ThemeMode): string {
  if (status === 'clipping') return theme === 'light' ? '#dc2626' : '#ef4444';
  if (status === 'overcut') return theme === 'light' ? '#d97706' : '#f59e0b';
  return theme === 'light' ? '#16a34a' : '#10b981';
}

export function extractSafetyHeatmapCells(
  sweepData: Float64Array,
  theme: ThemeMode = 'dark',
): SafetyHeatmapCell[] {
  const cells: SafetyHeatmapCell[] = [];
  for (let t = 0; t < SWEEP_STATES; t++) {
    const base = t * SWEEP_STRIDE;
    const rawClip = base < sweepData.length ? sweepData[base] : 0;
    const rawOver = base + 1 < sweepData.length ? sweepData[base + 1] : 0;
    const rawMaxOver = base + 2 < sweepData.length ? sweepData[base + 2] : 0;

    const clipping = Number.isFinite(rawClip) && rawClip >= 0.5;
    const wallOvercut = Number.isFinite(rawOver) && rawOver >= 0.5;
    const maxOvercut_um = Number.isFinite(rawMaxOver) ? rawMaxOver : 0;
    const status = classifySafetyState(clipping, wallOvercut);

    cells.push({
      progressPct: t,
      status,
      clipping,
      wallOvercut,
      maxOvercut_um,
      color: safetyColorForStatus(status, theme),
    });
  }
  return cells;
}

export function renderSafetyHeatmap(
  canvas: HTMLCanvasElement,
  sweepData: Float64Array,
  activeProgressPct: number,
  theme: ThemeMode = 'dark',
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const rect = canvas.getBoundingClientRect?.();
  let cssW = rect ? rect.width : canvas.width || 300;
  let cssH = rect ? rect.height : canvas.height || 18;

  if (rect && (cssW <= 0 || cssH <= 0)) {
    return;
  }
  if (!Number.isFinite(cssW) || cssW <= 0) cssW = 300;
  if (!Number.isFinite(cssH) || cssH <= 0) cssH = 18;

  const dpr =
    typeof window !== 'undefined' &&
    Number.isFinite(window.devicePixelRatio) &&
    window.devicePixelRatio > 0
      ? window.devicePixelRatio
      : 1;

  const targetW = Math.max(1, Math.round(cssW * dpr));
  const targetH = Math.max(1, Math.round(cssH * dpr));
  if (canvas.width !== targetW) canvas.width = targetW;
  if (canvas.height !== targetH) canvas.height = targetH;

  ctx.save();
  if (typeof ctx.setTransform === 'function') {
    ctx.setTransform(targetW / cssW, 0, 0, targetH / cssH, 0, 0);
  }

  const cells = extractSafetyHeatmapCells(sweepData, theme);
  const cellW = cssW / cells.length;

  for (let i = 0; i < cells.length; i++) {
    ctx.fillStyle = cells[i].color;
    const x0 = Math.floor(i * cellW);
    const x1 = Math.ceil((i + 1) * cellW);
    ctx.fillRect(x0, 0, Math.max(1, x1 - x0), cssH);
  }

  const clampedPct = Number.isFinite(activeProgressPct)
    ? Math.max(0, Math.min(100, activeProgressPct))
    : 0;
  const cursorX = (clampedPct / 100) * cssW;

  ctx.strokeStyle = theme === 'light' ? '#0f172a' : '#f8fafc';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cursorX, 0);
  ctx.lineTo(cursorX, cssH);
  ctx.stroke();

  ctx.restore();
}

export class TopDownCanvasRenderer extends BaseInteractiveCanvas<TopDownCanvasData> {
  private options: TopDownRenderOptions;

  constructor(
    canvas: HTMLCanvasElement,
    config: BaseCanvasConfig = {},
    initialOptions: Partial<TopDownRenderOptions> = {},
  ) {
    const defaults = createDefaultTopDownOptions();
    super(canvas, config);
    this.options = {
      ...defaults,
      ...initialOptions,
    };
  }

  getOptions(): TopDownRenderOptions {
    return {
      ...this.options,
      visiblePlanes: this.options.visiblePlanes
        ? [...this.options.visiblePlanes]
        : undefined,
    };
  }

  setOutput(output: PhysicsOutput): void {
    this.setData({
      output,
      options: this.getOptions(),
    });
  }

  setOptions(partial: Partial<TopDownRenderOptions>): void {
    this.options = {
      ...this.options,
      ...partial,
    };
    if (this.data) {
      this.setData({
        output: this.data.output,
        options: this.getOptions(),
      });
    }
  }

  setMode(mode: TopDownMode): void {
    this.setOptions({ mode });
  }

  setShowNozzleRings(show: boolean): void {
    this.setOptions({ showNozzleRings: show });
  }

  setOrbitIndex(orbitIndex: number): void {
    this.setOptions({ orbitIndex });
  }

  setOrbitAngleDeg(deg: number): void {
    this.setOptions({ orbitIndex: orbitDegreesToIndex(deg) });
  }

  setHoleType(holeType: HoleType): void {
    this.setOptions({ holeType });
  }

  protected override getViewportOptions(): ViewportOptions {
    return {
      lockAspect: true,
      invertY: true,
      padding: { top: 28, right: 24, bottom: 38, left: 60 },
    };
  }

  protected override shouldRefitOnDataChange(
    prev: TopDownCanvasData | null,
    next: TopDownCanvasData,
  ): boolean {
    if (!prev) return true;
    return prev.options.showNozzleRings !== next.options.showNozzleRings;
  }

  protected override getAutoBounds(data: TopDownCanvasData): WorldBounds {
    const { output, options } = data;
    const s = output.scalars;

    let maxR = Math.max(
      s.chartScaleMax_um,
      s.holeEntranceRadius_um,
      s.holeExitRadius_um,
      50,
    );

    if (options.showNozzleRings) {
      maxR = Math.max(
        maxR,
        s.nozzleApertureRadius_um,
        s.exitAperture1MaxR_um,
        s.exitAperture2MaxR_um,
      );
    }

    const padded = maxR * 1.15;
    return {
      minX: -padded,
      maxX: padded,
      minY: -padded,
      maxY: padded,
    };
  }

  protected override formatCrosshair(
    worldX: number,
    worldY: number,
  ): { labelX: string; labelY: string } {
    return {
      labelX: `X: ${formatNumberSafe(worldX, 1)} µm`,
      labelY: `Y: ${formatNumberSafe(worldY, 1)} µm`,
    };
  }

  private xyToScreen(x: number, y: number): Point2D | null {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return worldToScreen(this.viewport, x, y);
  }

  private isSliceVisible(sliceIdx: number, visiblePlanes?: readonly boolean[]): boolean {
    if (!visiblePlanes || sliceIdx >= visiblePlanes.length) return true;
    return Boolean(visiblePlanes[sliceIdx]);
  }

  protected override draw(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    palette: ThemePalette,
  ): void {
    const data = this.data;
    if (!data) return;
    const { output, options } = data;
    const s = output.scalars;

    const tl = screenToWorld(this.viewport, 0, 0);
    const br = screenToWorld(this.viewport, width, height);
    const visMinX = Math.min(tl.x, br.x);
    const visMaxX = Math.max(tl.x, br.x);
    const visMinY = Math.min(tl.y, br.y);
    const visMaxY = Math.max(tl.y, br.y);

    this.drawReticleAndRings(
      ctx,
      width,
      height,
      palette,
      visMinX,
      visMaxX,
      visMinY,
      visMaxY,
    );

    // Target Hole Entrance & Exit
    this.drawTargetHoleBoundaries(ctx, output, options.holeType, palette);

    // Optional Nozzle Aperture & Exit 1 / Exit 2 beam footprints
    if (options.showNozzleRings) {
      this.drawNozzleRings(ctx, output, palette);
    }

    // 6 Material Depth Slices (p = 2..7)
    this.drawDepthSlices(ctx, output, options, palette);

    // Active Orbit Scrubber Footprint & Beam Axis Projection
    this.drawOrbitFootprint(ctx, output, options, palette);

    // Corner Legend
    this.drawModeOverlay(ctx, options, s, palette);
  }

  private drawReticleAndRings(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    palette: ThemePalette,
    visMinX: number,
    visMaxX: number,
    visMinY: number,
    visMaxY: number,
  ): void {
    ctx.save();
    ctx.strokeStyle = palette.grid;
    ctx.lineWidth = 1;
    ctx.fillStyle = palette.text;
    ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace';

    // Origin axes
    const origin = worldToScreen(this.viewport, 0, 0);
    ctx.beginPath();
    ctx.moveTo(origin.x, 0);
    ctx.lineTo(origin.x, height);
    ctx.moveTo(0, origin.y);
    ctx.lineTo(width, origin.y);
    ctx.stroke();

    const maxVisR = Math.max(
      Math.abs(visMinX),
      Math.abs(visMaxX),
      Math.abs(visMinY),
      Math.abs(visMaxY),
    );
    const ticks = computeNiceTicks(0, maxVisR, Math.min(width, height) / 2, 70);
    const pxPerUm = this.viewport.scaleX;

    for (const r of ticks.ticks) {
      if (r <= 0) continue;
      const rPx = r * pxPerUm;
      if (rPx < 8 || rPx > Math.max(width, height) * 1.5) continue;
      ctx.beginPath();
      ctx.arc(origin.x, origin.y, rPx, 0, Math.PI * 2);
      ctx.stroke();
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';
      ctx.fillText(`R=${formatNumberSafe(r, 0)}µm`, origin.x + rPx + 3, origin.y - 2);
    }

    ctx.restore();
  }

  private drawTargetHoleBoundaries(
    ctx: CanvasRenderingContext2D,
    output: PhysicsOutput,
    holeType: HoleType,
    palette: ThemePalette,
  ): void {
    ctx.save();
    const s = output.scalars;
    const path = output.trepanningPath;

    if (holeType === 'square') {
      const drawSquare = (r: number, color: string, dashed: boolean, lineW: number) => {
        if (!Number.isFinite(r) || r <= 0) return;
        const tl = worldToScreen(this.viewport, -r, r);
        const br = worldToScreen(this.viewport, r, -r);
        ctx.strokeStyle = color;
        ctx.lineWidth = lineW;
        ctx.setLineDash(dashed ? [6, 4] : []);
        ctx.strokeRect(
          Math.min(tl.x, br.x),
          Math.min(tl.y, br.y),
          Math.abs(br.x - tl.x),
          Math.abs(br.y - tl.y),
        );
      };
      drawSquare(s.holeExitRadius_um, palette.holeExit, true, 2);
      drawSquare(s.holeEntranceRadius_um, palette.holeEntrance, false, 2.5);
      ctx.setLineDash([]);
      ctx.restore();
      return;
    }

    // Round hole exit (dashed outer purple)
    ctx.strokeStyle = palette.holeExit;
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    strokeLoopWithNaNBreaks(ctx, PATH_STEPS, (i) =>
      this.xyToScreen(path.holeExitXY[i * 2], path.holeExitXY[i * 2 + 1]),
    );

    // Round hole entrance (solid purple)
    ctx.strokeStyle = palette.holeEntrance;
    ctx.lineWidth = 2.5;
    ctx.setLineDash([]);
    strokeLoopWithNaNBreaks(ctx, PATH_STEPS, (i) =>
      this.xyToScreen(path.holeEntranceXY[i * 2], path.holeEntranceXY[i * 2 + 1]),
    );

    ctx.restore();
  }

  private drawNozzleRings(
    ctx: CanvasRenderingContext2D,
    output: PhysicsOutput,
    palette: ThemePalette,
  ): void {
    ctx.save();
    const s = output.scalars;
    const path = output.trepanningPath;
    const rNoz = s.nozzleApertureRadius_um;
    const origin = worldToScreen(this.viewport, 0, 0);

    // Physical Nozzle Aperture reference circle
    if (Number.isFinite(rNoz) && rNoz > 0) {
      ctx.strokeStyle = s.nozzleClipping ? palette.clipping : palette.nozzleAperture;
      ctx.lineWidth = s.nozzleClipping ? 2.5 : 2;
      ctx.setLineDash([8, 4]);
      ctx.beginPath();
      ctx.arc(origin.x, origin.y, rNoz * this.viewport.scaleX, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Exit Aperture 1 (p = 0) & Exit Aperture 2 (p = 1) 1/e² beam footprints
    const exit1Clipped = s.exitAperture1MaxR_um >= rNoz;
    const exit2Clipped = s.exitAperture2MaxR_um >= rNoz;

    ctx.lineWidth = 1.6;
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = exit1Clipped ? palette.clipping : palette.nozzleStroke;
    strokeLoopWithNaNBreaks(ctx, CONTOUR_STEPS, (j) => {
      const idx = (PLANE_INDEX.EXIT_APERTURE_1 * CONTOUR_STEPS + j) * 2;
      return this.xyToScreen(path.plane1e2XY[idx], path.plane1e2XY[idx + 1]);
    });

    ctx.setLineDash([6, 3]);
    ctx.strokeStyle = exit2Clipped ? palette.clipping : palette.nozzleAperture;
    strokeLoopWithNaNBreaks(ctx, CONTOUR_STEPS, (j) => {
      const idx = (PLANE_INDEX.EXIT_APERTURE_2 * CONTOUR_STEPS + j) * 2;
      return this.xyToScreen(path.plane1e2XY[idx], path.plane1e2XY[idx + 1]);
    });

    ctx.setLineDash([]);
    ctx.restore();
  }

  private drawDepthSlices(
    ctx: CanvasRenderingContext2D,
    output: PhysicsOutput,
    options: TopDownRenderOptions,
    palette: ThemePalette,
  ): void {
    ctx.save();
    const path = output.trepanningPath;
    const mode = options.mode;

    for (let sIdx = 0; sIdx < SLICE_PLANE_INDICES.length; sIdx++) {
      if (!this.isSliceVisible(sIdx, options.visiblePlanes)) continue;
      const p = SLICE_PLANE_INDICES[sIdx];
      const sliceColor = palette.sliceColors[sIdx % palette.sliceColors.length];

      // Chart 3: Beam Center Path
      if (mode === 'beam_path' || mode === 'all') {
        ctx.strokeStyle = sliceColor;
        ctx.lineWidth = mode === 'beam_path' ? 2 : 1.5;
        ctx.setLineDash([]);
        strokeLoopWithNaNBreaks(ctx, PATH_STEPS, (i) => {
          const idx = (p * PATH_STEPS + i) * 2;
          return this.xyToScreen(path.planeCenterXY[idx], path.planeCenterXY[idx + 1]);
        });
      }

      // Chart 4: 1/e² Outer Contour
      if (mode === 'contour_1e2' || mode === 'all') {
        ctx.strokeStyle = sliceColor;
        ctx.lineWidth = mode === 'contour_1e2' ? 1.8 : 1.25;
        ctx.setLineDash(mode === 'all' ? [4, 3] : []);
        strokeLoopWithNaNBreaks(ctx, CONTOUR_STEPS, (j) => {
          const idx = (p * CONTOUR_STEPS + j) * 2;
          return this.xyToScreen(path.plane1e2XY[idx], path.plane1e2XY[idx + 1]);
        });
      }

      // Chart 5: Ablation Contour (planes 2..7, NaN-safe)
      if (mode === 'contour_ablation' || mode === 'all') {
        if (!Number.isNaN(path.planeRAbl[p])) {
          ctx.strokeStyle = mode === 'contour_ablation' ? sliceColor : palette.ablation;
          ctx.lineWidth = mode === 'contour_ablation' ? 2 : 1.35;
          ctx.setLineDash([]);
          strokeLoopWithNaNBreaks(ctx, CONTOUR_STEPS, (j) => {
            const idx = ((p - 2) * CONTOUR_STEPS + j) * 2;
            return this.xyToScreen(path.planeAblXY[idx], path.planeAblXY[idx + 1]);
          });
        }
      }
    }

    ctx.setLineDash([]);
    ctx.restore();
  }

  private drawOrbitFootprint(
    ctx: CanvasRenderingContext2D,
    output: PhysicsOutput,
    options: TopDownRenderOptions,
    palette: ThemePalette,
  ): void {
    ctx.save();
    const path = output.trepanningPath;
    const rawIdx = Number.isFinite(options.orbitIndex)
      ? Math.round(options.orbitIndex)
      : 0;
    const centerIdx = ((rawIdx % PATH_STEPS) + PATH_STEPS) % PATH_STEPS;

    // Projected tilted beam centerline across planes
    const axisPlaneStart = options.showNozzleRings
      ? PLANE_INDEX.EXIT_APERTURE_1
      : PLANE_INDEX.FOCUS;
    ctx.strokeStyle = palette.textBright;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    let started = false;
    for (let p = axisPlaneStart; p <= PLANE_INDEX.BOTTOM; p++) {
      const idx = (p * PATH_STEPS + centerIdx) * 2;
      const sc = this.xyToScreen(path.planeCenterXY[idx], path.planeCenterXY[idx + 1]);
      if (!sc) continue;
      if (!started) {
        ctx.moveTo(sc.x, sc.y);
        started = true;
      } else {
        ctx.lineTo(sc.x, sc.y);
      }
    }
    if (started) ctx.stroke();
    ctx.setLineDash([]);

    // Instantaneous beam footprint circles on Focus, Top, and Bottom slices
    const highlightPlanes = [
      PLANE_INDEX.FOCUS,
      PLANE_INDEX.TOP,
      PLANE_INDEX.BOTTOM,
    ] as const;

    for (const p of highlightPlanes) {
      const sliceIdx = p - 2;
      if (!this.isSliceVisible(sliceIdx, options.visiblePlanes)) continue;
      const idx = (p * PATH_STEPS + centerIdx) * 2;
      const sc = this.xyToScreen(path.planeCenterXY[idx], path.planeCenterXY[idx + 1]);
      if (!sc) continue;

      const wUm = path.planeW[p];
      const rAblUm = path.planeRAbl[p];

      if (
        options.mode !== 'contour_ablation' &&
        Number.isFinite(wUm) &&
        wUm > 0
      ) {
        ctx.fillStyle = palette.beamWaistFill;
        ctx.strokeStyle = palette.beamWaist;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.arc(sc.x, sc.y, Math.max(2, wUm * this.viewport.scaleX), 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }

      if (
        options.mode !== 'contour_1e2' &&
        Number.isFinite(rAblUm) &&
        rAblUm > 0
      ) {
        ctx.fillStyle = palette.ablationFill;
        ctx.strokeStyle = palette.ablation;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.arc(sc.x, sc.y, Math.max(1.5, rAblUm * this.viewport.scaleX), 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }

    // Active Focus center dot
    const focusIdx = (PLANE_INDEX.FOCUS * PATH_STEPS + centerIdx) * 2;
    const focusPt = this.xyToScreen(
      path.planeCenterXY[focusIdx],
      path.planeCenterXY[focusIdx + 1],
    );
    if (focusPt) {
      ctx.fillStyle = palette.accent;
      ctx.beginPath();
      ctx.arc(focusPt.x, focusPt.y, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  private drawModeOverlay(
    ctx: CanvasRenderingContext2D,
    options: TopDownRenderOptions,
    s: PhysicsOutput['scalars'],
    palette: ThemePalette,
  ): void {
    ctx.save();
    ctx.font = '11px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';

    const lines = [
      `Mode: ${options.mode} | Hole: ${options.holeType}`,
      `Nozzle: ${s.nozzleClipping ? 'CLIPPING' : 'Clear'}`,
    ];
    let y = 10;
    for (const line of lines) {
      const isClipLine = line.includes('CLIPPING');
      ctx.fillStyle = isClipLine ? palette.clipping : palette.textBright;
      ctx.fillText(line, 12, y);
      y += 16;
    }
    ctx.restore();
  }

  getSummaryTable(): SummaryTableSpec {
    if (!this.data) {
      return {
        caption: 'Multi-Plane 3D Path & Contours Summary (Charts 3–5)',
        headers: ['Plane', 'Z (Focus-Rel µm)', '1/e² Radius (µm)', 'Ablation Radius (µm)', 'Status'],
        rows: [['Status', '—', '—', '—', 'Awaiting calculation']],
      };
    }

    const { output, options } = this.data;
    const s = output.scalars;
    const path = output.trepanningPath;
    const rows: string[][] = [];

    for (let p = 0; p < PLANE_LABELS.length; p++) {
      const zVal = formatNumberSafe(path.planeZ[p], 1);
      const wVal = formatNumberSafe(path.planeW[p], 2);
      const rAbl = path.planeRAbl[p];
      const ablStr =
        p < 2
          ? 'N/A (Nozzle)'
          : Number.isFinite(rAbl)
            ? formatNumberSafe(rAbl, 2)
            : 'No ablation';

      let status = 'Material slice';
      if (p === 0) {
        status =
          s.exitAperture1MaxR_um >= s.nozzleApertureRadius_um
            ? `Clipping (MaxR ${formatNumberSafe(s.exitAperture1MaxR_um, 1)} µm)`
            : `Clear (MaxR ${formatNumberSafe(s.exitAperture1MaxR_um, 1)} µm)`;
      } else if (p === 1) {
        status =
          s.exitAperture2MaxR_um >= s.nozzleApertureRadius_um
            ? `Clipping (MaxR ${formatNumberSafe(s.exitAperture2MaxR_um, 1)} µm)`
            : `Clear (MaxR ${formatNumberSafe(s.exitAperture2MaxR_um, 1)} µm)`;
      } else if (options.holeType === 'square') {
        status = 'Square hole slice';
      }

      rows.push([PLANE_LABELS[p], zVal, wVal, ablStr, status]);
    }

    return {
      caption: 'Multi-Plane 3D Path & Contours Summary (Charts 3–5)',
      headers: [
        'Plane',
        'Z (Focus-Rel µm)',
        '1/e² Radius (µm)',
        'Ablation Radius (µm)',
        'Status',
      ],
      rows,
    };
  }
}
