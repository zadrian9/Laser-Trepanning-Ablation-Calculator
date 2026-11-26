/**
 * Tab 4 — Chart 6: Focus Energy Distribution Canvas Renderer.
 * Renders the 601-point Gaussian fluence distribution over r/w0 in [-3, +3],
 * analytical ±r_th split shading for Ablation (F >= F_th) vs No-Ablation (F < F_th),
 * Ablation Threshold line, ±w0 & ±r_th markers, and Normalized / J/cm² unit toggle.
 */

import {
  DIST_COL,
  DIST_POINTS,
  DIST_STRIDE,
  type PhysicsOutput,
} from '../types/physics.ts';
import {
  BaseInteractiveCanvas,
  computeNiceTicks,
  formatNumberSafe,
  screenToWorld,
  strokePolylineWithNaNBreaks,
  worldToScreen,
  type BaseCanvasConfig,
  type SummaryTableSpec,
  type ThemePalette,
  type ViewportOptions,
  type WorldBounds,
} from './baseCanvas.ts';

export type FluenceUnitMode = 'normalized' | 'fluence';

export interface FluenceRenderOptions {
  unitMode: FluenceUnitMode;
}

export interface FluenceCanvasData {
  output: PhysicsOutput;
  options: FluenceRenderOptions;
}

export function createDefaultFluenceOptions(): FluenceRenderOptions {
  return {
    unitMode: 'normalized',
  };
}

export interface AnalyticalSplitGeometry {
  hasAblation: boolean;
  rThNorm: number;
  rThClamped: number;
  rThUm: number;
  yThresh: number;
  yAtRTh: number;
  scaleY: number;
  w0Eff: number;
  maxR: number;
}

export function computeFluenceSplitGeometry(
  output: PhysicsOutput,
  unitMode: FluenceUnitMode,
): AnalyticalSplitGeometry {
  const s = output.scalars;
  const w0Eff = Number.isFinite(s.w0_um) && s.w0_um > 0 ? s.w0_um : 1;
  const maxR = 3 * w0Eff;
  const scaleY =
    unitMode === 'fluence' && Number.isFinite(s.peakFluence_J_cm2)
      ? Math.max(0, s.peakFluence_J_cm2)
      : 1;

  const hasValidRatio =
    Number.isFinite(s.peakFluence_J_cm2) &&
    s.peakFluence_J_cm2 > 0 &&
    Number.isFinite(s.thresholdRatio) &&
    s.thresholdRatio > 0 &&
    s.thresholdRatio < 1;

  const rThNorm = hasValidRatio ? Math.sqrt(-0.5 * Math.log(s.thresholdRatio)) : 0;
  const rThClamped = Math.min(3, rThNorm);
  const rThUm = rThClamped * w0Eff;

  const yThresh =
    unitMode === 'fluence'
      ? Number.isFinite(s.ablationThreshold_J_cm2)
        ? s.ablationThreshold_J_cm2
        : 0
      : Number.isFinite(s.thresholdRatio)
        ? s.thresholdRatio
        : 0;

  const yAtRTh = Math.exp(-2 * rThClamped * rThClamped) * scaleY;

  return {
    hasAblation: rThNorm > 0,
    rThNorm,
    rThClamped,
    rThUm,
    yThresh,
    yAtRTh,
    scaleY,
    w0Eff,
    maxR,
  };
}

export class FluenceCanvasRenderer extends BaseInteractiveCanvas<FluenceCanvasData> {
  private options: FluenceRenderOptions;

  constructor(
    canvas: HTMLCanvasElement,
    config: BaseCanvasConfig = {},
    initialOptions: Partial<FluenceRenderOptions> = {},
  ) {
    const defaults = createDefaultFluenceOptions();
    super(canvas, config);
    this.options = {
      unitMode: initialOptions.unitMode ?? defaults.unitMode,
    };
  }

  getOptions(): FluenceRenderOptions {
    return { ...this.options };
  }

  setOutput(output: PhysicsOutput): void {
    this.setData({
      output,
      options: this.getOptions(),
    });
  }

  setOptions(partial: Partial<FluenceRenderOptions>): void {
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

  setUnitMode(unitMode: FluenceUnitMode): void {
    this.setOptions({ unitMode });
  }

  protected override getViewportOptions(): ViewportOptions {
    return {
      lockAspect: false,
      invertY: true,
      padding: { top: 32, right: 24, bottom: 40, left: 68 },
    };
  }

  protected override shouldForceRefitOnDataChange(
    prev: FluenceCanvasData | null,
    next: FluenceCanvasData,
  ): boolean {
    if (!prev) return false;
    return prev.options.unitMode !== next.options.unitMode;
  }

  protected override shouldRefitOnDataChange(
    prev: FluenceCanvasData | null,
    next: FluenceCanvasData,
  ): boolean {
    if (!prev) return true;
    return prev.options.unitMode !== next.options.unitMode;
  }

  protected override getAutoBounds(data: FluenceCanvasData): WorldBounds {
    const { output, options } = data;
    const s = output.scalars;
    const w0Eff = Number.isFinite(s.w0_um) && s.w0_um > 0 ? s.w0_um : 1;
    const maxR = 3 * w0Eff;

    let maxY: number;
    if (options.unitMode === 'fluence') {
      const peak = Number.isFinite(s.peakFluence_J_cm2) ? s.peakFluence_J_cm2 : 1;
      const thresh = Number.isFinite(s.ablationThreshold_J_cm2)
        ? s.ablationThreshold_J_cm2
        : 0;
      maxY = Math.max(peak * 1.15, thresh * 1.15, 1);
    } else {
      const threshRatio = Number.isFinite(s.thresholdRatio) ? s.thresholdRatio : 0;
      maxY = Math.max(1.15, Math.min(threshRatio * 1.15, 2.5));
    }

    return {
      minX: -maxR,
      maxX: maxR,
      minY: 0,
      maxY,
    };
  }

  protected override formatCrosshair(
    worldX: number,
    worldY: number,
  ): { labelX: string; labelY: string } {
    const unitMode = this.data?.options.unitMode ?? this.options.unitMode;
    const yLabel =
      unitMode === 'fluence'
        ? `F: ${formatNumberSafe(worldY, 2)} J/cm²`
        : `F/F₀: ${formatNumberSafe(worldY, 3)}`;
    return {
      labelX: `R: ${formatNumberSafe(worldX, 2)} µm`,
      labelY: yLabel,
    };
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
    const geom = computeFluenceSplitGeometry(output, options.unitMode);

    const tl = screenToWorld(this.viewport, 0, 0);
    const br = screenToWorld(this.viewport, width, height);
    const visMinR = Math.min(tl.x, br.x);
    const visMaxR = Math.max(tl.x, br.x);
    const visMinY = Math.min(tl.y, br.y);
    const visMaxY = Math.max(tl.y, br.y);

    this.drawGridAndAxes(
      ctx,
      width,
      height,
      palette,
      options.unitMode,
      visMinR,
      visMaxR,
      visMinY,
      visMaxY,
    );

    this.drawShadedRegions(ctx, output.focusDist, s.w0_um, geom, palette);
    this.drawGaussianCurve(ctx, output.focusDist, s.w0_um, geom, palette);
    this.drawMarkers(
      ctx,
      width,
      height,
      s,
      geom,
      options.unitMode,
      visMinR,
      visMaxR,
      visMinY,
      visMaxY,
      palette,
    );
  }

  private drawGridAndAxes(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    palette: ThemePalette,
    unitMode: FluenceUnitMode,
    visMinR: number,
    visMaxR: number,
    visMinY: number,
    visMaxY: number,
  ): void {
    ctx.save();
    ctx.strokeStyle = palette.grid;
    ctx.lineWidth = 1;
    ctx.fillStyle = palette.text;
    ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace';

    const rTicks = computeNiceTicks(visMinR, visMaxR, width, 80);
    const yTicks = computeNiceTicks(Math.max(0, visMinY), visMaxY, height, 60);

    for (const r of rTicks.ticks) {
      const p1 = worldToScreen(this.viewport, r, visMinY);
      const p2 = worldToScreen(this.viewport, r, visMaxY);
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();

      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(`R=${formatNumberSafe(r, 1)}µm`, p1.x, height - 6);
    }

    for (const yVal of yTicks.ticks) {
      const p1 = worldToScreen(this.viewport, visMinR, yVal);
      const p2 = worldToScreen(this.viewport, visMaxR, yVal);
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();

      const lbl =
        unitMode === 'fluence'
          ? `${formatNumberSafe(yVal, yVal >= 10 ? 0 : 1)} J/cm²`
          : formatNumberSafe(yVal, 2);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';
      ctx.fillText(lbl, 8, p1.y - 3);
    }

    // Baseline y = 0 and centerline r = 0
    ctx.strokeStyle = palette.axis;
    ctx.lineWidth = 1.25;
    const b1 = worldToScreen(this.viewport, visMinR, 0);
    const b2 = worldToScreen(this.viewport, visMaxR, 0);
    ctx.beginPath();
    ctx.moveTo(b1.x, b1.y);
    ctx.lineTo(b2.x, b2.y);
    ctx.stroke();

    const c1 = worldToScreen(this.viewport, 0, Math.max(0, visMinY));
    const c2 = worldToScreen(this.viewport, 0, visMaxY);
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(c1.x, c1.y);
    ctx.lineTo(c2.x, c2.y);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.restore();
  }

  private resolvePointRUm(
    focusDist: Float64Array,
    i: number,
    useFallbackR: boolean,
    w0Eff: number,
  ): number {
    const base = i * DIST_STRIDE;
    const rNorm = focusDist[base + DIST_COL.R_NORM];
    const rUm = focusDist[base + DIST_COL.R_UM];
    if (!useFallbackR && Number.isFinite(rUm) && Math.abs(rUm) > 0) {
      return rUm;
    }
    return rNorm * w0Eff;
  }

  private shouldUseFallbackR(focusDist: Float64Array, w0_um: number): boolean {
    return (
      !(Number.isFinite(w0_um) && w0_um > 0) ||
      (!Number.isFinite(focusDist[0]) && !Number.isFinite(focusDist[DIST_STRIDE]))
    );
  }

  private drawShadedRegions(
    ctx: CanvasRenderingContext2D,
    focusDist: Float64Array,
    w0_um: number,
    geom: AnalyticalSplitGeometry,
    palette: ThemePalette,
  ): void {
    ctx.save();
    const useFallbackR = this.shouldUseFallbackR(focusDist, w0_um);
    const pointRUm = (i: number): number =>
      this.resolvePointRUm(focusDist, i, useFallbackR, geom.w0Eff);

    const pointY = (i: number): number =>
      focusDist[i * DIST_STRIDE + DIST_COL.GAUSSIAN] * geom.scaleY;

    if (!geom.hasAblation) {
      // Entire curve is below ablation threshold -> No-Ablation fill only
      ctx.fillStyle = palette.noAblationFill;
      ctx.beginPath();
      const firstPt = worldToScreen(this.viewport, -geom.maxR, 0);
      ctx.moveTo(firstPt.x, firstPt.y);
      for (let i = 0; i < DIST_POINTS; i++) {
        const sc = worldToScreen(this.viewport, pointRUm(i), pointY(i));
        ctx.lineTo(sc.x, sc.y);
      }
      const lastPt = worldToScreen(this.viewport, geom.maxR, 0);
      ctx.lineTo(lastPt.x, lastPt.y);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      return;
    }

    // Left No-Ablation Wing: [-maxR .. -rThUm]
    if (geom.rThClamped < 3) {
      ctx.fillStyle = palette.noAblationFill;
      ctx.beginPath();
      const baseLeft = worldToScreen(this.viewport, -geom.maxR, 0);
      ctx.moveTo(baseLeft.x, baseLeft.y);
      for (let i = 0; i < DIST_POINTS; i++) {
        const r = pointRUm(i);
        if (r >= -geom.rThUm) break;
        const sc = worldToScreen(this.viewport, r, pointY(i));
        ctx.lineTo(sc.x, sc.y);
      }
      const exactNegTop = worldToScreen(this.viewport, -geom.rThUm, geom.yAtRTh);
      const exactNegBot = worldToScreen(this.viewport, -geom.rThUm, 0);
      ctx.lineTo(exactNegTop.x, exactNegTop.y);
      ctx.lineTo(exactNegBot.x, exactNegBot.y);
      ctx.closePath();
      ctx.fill();

      // Right No-Ablation Wing: [+rThUm .. +maxR]
      ctx.beginPath();
      const exactPosBot = worldToScreen(this.viewport, geom.rThUm, 0);
      const exactPosTop = worldToScreen(this.viewport, geom.rThUm, geom.yAtRTh);
      ctx.moveTo(exactPosBot.x, exactPosBot.y);
      ctx.lineTo(exactPosTop.x, exactPosTop.y);
      for (let i = 0; i < DIST_POINTS; i++) {
        const r = pointRUm(i);
        if (r <= geom.rThUm) continue;
        const sc = worldToScreen(this.viewport, r, pointY(i));
        ctx.lineTo(sc.x, sc.y);
      }
      const baseRight = worldToScreen(this.viewport, geom.maxR, 0);
      ctx.lineTo(baseRight.x, baseRight.y);
      ctx.closePath();
      ctx.fill();
    }

    // Central Ablation Zone: [-rThUm .. +rThUm] with exact analytical boundary endpoints
    ctx.fillStyle = palette.ablationFill;
    ctx.beginPath();
    const ablStartBot = worldToScreen(this.viewport, -geom.rThUm, 0);
    const ablStartTop = worldToScreen(this.viewport, -geom.rThUm, geom.yAtRTh);
    ctx.moveTo(ablStartBot.x, ablStartBot.y);
    ctx.lineTo(ablStartTop.x, ablStartTop.y);

    let peakIncluded = false;
    for (let i = 0; i < DIST_POINTS; i++) {
      const r = pointRUm(i);
      if (r > -geom.rThUm && r < geom.rThUm) {
        if (Math.abs(r) < 1e-9) peakIncluded = true;
        const sc = worldToScreen(this.viewport, r, pointY(i));
        ctx.lineTo(sc.x, sc.y);
      }
    }
    if (!peakIncluded) {
      const peakSc = worldToScreen(this.viewport, 0, geom.scaleY);
      ctx.lineTo(peakSc.x, peakSc.y);
    }

    const ablEndTop = worldToScreen(this.viewport, geom.rThUm, geom.yAtRTh);
    const ablEndBot = worldToScreen(this.viewport, geom.rThUm, 0);
    ctx.lineTo(ablEndTop.x, ablEndTop.y);
    ctx.lineTo(ablEndBot.x, ablEndBot.y);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
  }

  private drawGaussianCurve(
    ctx: CanvasRenderingContext2D,
    focusDist: Float64Array,
    w0_um: number,
    geom: AnalyticalSplitGeometry,
    palette: ThemePalette,
  ): void {
    ctx.save();
    const useFallbackR = this.shouldUseFallbackR(focusDist, w0_um);
    ctx.strokeStyle = palette.beamWaist;
    ctx.lineWidth = 2.5;
    strokePolylineWithNaNBreaks(ctx, DIST_POINTS, (i) => {
      const base = i * DIST_STRIDE;
      const rNorm = focusDist[base + DIST_COL.R_NORM];
      const g = focusDist[base + DIST_COL.GAUSSIAN];
      if (!Number.isFinite(g) || !Number.isFinite(rNorm)) return null;
      const r = this.resolvePointRUm(focusDist, i, useFallbackR, geom.w0Eff);
      return worldToScreen(this.viewport, r, g * geom.scaleY);
    });
    ctx.restore();
  }

  private drawMarkers(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    s: PhysicsOutput['scalars'],
    geom: AnalyticalSplitGeometry,
    unitMode: FluenceUnitMode,
    visMinR: number,
    visMaxR: number,
    visMinY: number,
    visMaxY: number,
    palette: ThemePalette,
  ): void {
    ctx.save();

    // ±w0 markers
    if (s.w0_um > 0) {
      ctx.strokeStyle = palette.beamWaist;
      ctx.lineWidth = 1.25;
      ctx.setLineDash([4, 4]);
      for (const sign of [-1, 1] as const) {
        const xW = sign * s.w0_um;
        const p1 = worldToScreen(this.viewport, xW, Math.max(0, visMinY));
        const p2 = worldToScreen(this.viewport, xW, visMaxY);
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.stroke();

        ctx.fillStyle = palette.beamWaist;
        ctx.font = '10px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(sign < 0 ? '-w₀' : '+w₀', p1.x, Math.max(16, p2.y + 12));
      }
    }

    // ±r_th markers
    if (geom.hasAblation && geom.rThNorm <= 3) {
      ctx.strokeStyle = palette.ablation;
      ctx.lineWidth = 1.25;
      ctx.setLineDash([3, 3]);
      for (const sign of [-1, 1] as const) {
        const xTh = sign * geom.rThUm;
        const p1 = worldToScreen(this.viewport, xTh, 0);
        const p2 = worldToScreen(this.viewport, xTh, geom.yAtRTh);
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.stroke();
      }
    }

    // Horizontal Ablation Threshold line
    if (Number.isFinite(geom.yThresh)) {
      const threshLabel =
        unitMode === 'fluence'
          ? `Threshold = ${formatNumberSafe(s.ablationThreshold_J_cm2, 2)} J/cm²`
          : `Threshold Ratio = ${formatNumberSafe(s.thresholdRatio, 4)} F/F₀`;

      if (geom.yThresh <= visMaxY) {
        const t1 = worldToScreen(this.viewport, visMinR, geom.yThresh);
        const t2 = worldToScreen(this.viewport, visMaxR, geom.yThresh);
        ctx.strokeStyle = palette.ablation;
        ctx.lineWidth = 1.75;
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.moveTo(t1.x, t1.y);
        ctx.lineTo(t2.x, t2.y);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.fillStyle = palette.ablation;
        ctx.font = 'bold 11px system-ui, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(threshLabel, 74, Math.max(18, t1.y - 6));
      } else {
        ctx.setLineDash([]);
        ctx.fillStyle = palette.ablation;
        ctx.font = 'bold 11px system-ui, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(`${threshLabel} (above axis)`, 74, 18);
      }
    }

    // Peak Fluence / Normalized Peak label
    const peakPos = worldToScreen(this.viewport, 0, geom.scaleY);
    ctx.fillStyle = palette.textBright;
    ctx.font = 'bold 11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    const peakLabel =
      unitMode === 'fluence'
        ? `Peak: ${formatNumberSafe(s.peakFluence_J_cm2, 2)} J/cm²`
        : 'Normalized Peak: 1.000';
    ctx.fillText(
      peakLabel,
      Math.max(80, Math.min(width - 80, peakPos.x)),
      Math.max(16, Math.min(height - 30, peakPos.y - 8)),
    );

    ctx.setLineDash([]);
    ctx.restore();
  }

  getSummaryTable(): SummaryTableSpec {
    if (!this.data) {
      return {
        caption: 'Focus Energy Distribution Summary (Chart 6)',
        headers: ['Metric', 'Value', 'Unit'],
        rows: [['Status', 'Awaiting calculation', '—']],
      };
    }

    const { output, options } = this.data;
    const s = output.scalars;
    const isFluence = options.unitMode === 'fluence';

    const peakLabel = isFluence ? 'Peak Fluence (F₀)' : 'Normalized Peak Intensity';
    const peakValue = isFluence ? formatNumberSafe(s.peakFluence_J_cm2, 2) : '1.000';
    const peakUnit = isFluence ? 'J/cm²' : 'F/F₀';

    const threshLabel = isFluence
      ? 'Ablation Threshold (F_th)'
      : 'Threshold Ratio (F_th / F₀)';
    const threshValue = isFluence
      ? formatNumberSafe(s.ablationThreshold_J_cm2, 3)
      : formatNumberSafe(s.thresholdRatio, 4);
    const threshUnit = isFluence ? 'J/cm²' : 'F/F₀';

    const rThUm =
      Number.isFinite(s.thresholdR) && s.thresholdR > 0 && s.w0_um > 0
        ? formatNumberSafe(s.thresholdR * s.w0_um, 2)
        : 'No ablation';

    return {
      caption: 'Focus Energy Distribution Summary (Chart 6)',
      headers: ['Metric', 'Value', 'Unit'],
      rows: [
        [peakLabel, peakValue, peakUnit],
        [threshLabel, threshValue, threshUnit],
        ['Beam Waist Radius (w₀)', formatNumberSafe(s.w0_um, 3), 'µm'],
        ['Normalized Threshold Radius (r_th / w₀)', formatNumberSafe(s.thresholdR, 4), 'ratio'],
        ['Ablation Threshold Radius (r_th)', rThUm, rThUm === 'No ablation' ? 'status' : 'µm'],
        ['Ablated Spot Diameter at Focus', formatNumberSafe(s.ablatedSpotAt0_um, 2), 'µm'],
        ['Energy Above Threshold', formatNumberSafe(s.energyAboveThresh_pct, 2), '%'],
      ],
    };
  }
}
