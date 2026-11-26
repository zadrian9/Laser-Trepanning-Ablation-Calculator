/**
 * Tab 1 — Chart 2: Trepanning Cross-Section Canvas Renderer.
 * Renders the 2-plane nozzle bore (part-frame Z aligned), tapered workpiece hole walls,
 * forward & backward 1/e² and ablation envelopes (NaN-safe), optional 180° ghost
 * counter-beam, Graph Limit Expansion (min/max swap guarded), and Vertical/Horizontal Z.
 */

import { DEFAULT_GRAPH_LIMITS } from '../data/presets.ts';
import { mirrorCounterBeam } from '../math/trepanning.ts';
import {
  PROFILE_CURVE,
  PROFILE_POINTS,
  PROFILE_STRIDE,
  type GraphLimits,
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
  type Point2D,
  type SummaryTableSpec,
  type ThemePalette,
  type ViewportOptions,
  type WorldBounds,
} from './baseCanvas.ts';

export type ProfileOrientation = 'vertical' | 'horizontal';
export type GraphLimitFitMode = 'expand' | 'exact';

export interface ProfileRenderOptions {
  orientation: ProfileOrientation;
  showCounterBeam: boolean;
  graphLimits: GraphLimits;
  showNozzle?: boolean;
  fitMode?: GraphLimitFitMode;
}

export interface ProfileCanvasData {
  output: PhysicsOutput;
  options: ProfileRenderOptions;
}

export function createDefaultProfileOptions(): ProfileRenderOptions {
  return {
    orientation: 'vertical',
    showCounterBeam: false,
    graphLimits: { ...DEFAULT_GRAPH_LIMITS },
    showNozzle: true,
    fitMode: 'expand',
  };
}

export function normalizeGraphLimits(limits: GraphLimits): GraphLimits {
  const zA = Number.isFinite(limits.zMin_um)
    ? limits.zMin_um
    : DEFAULT_GRAPH_LIMITS.zMin_um;
  const zB = Number.isFinite(limits.zMax_um)
    ? limits.zMax_um
    : DEFAULT_GRAPH_LIMITS.zMax_um;
  const rA = Number.isFinite(limits.rMin_um)
    ? limits.rMin_um
    : DEFAULT_GRAPH_LIMITS.rMin_um;
  const rB = Number.isFinite(limits.rMax_um)
    ? limits.rMax_um
    : DEFAULT_GRAPH_LIMITS.rMax_um;

  return {
    zMin_um: Math.min(zA, zB),
    zMax_um: Math.max(zA, zB),
    rMin_um: Math.min(rA, rB),
    rMax_um: Math.max(rA, rB),
  };
}

export class ProfileCanvasRenderer extends BaseInteractiveCanvas<ProfileCanvasData> {
  private options: ProfileRenderOptions;

  constructor(
    canvas: HTMLCanvasElement,
    config: BaseCanvasConfig = {},
    initialOptions: Partial<ProfileRenderOptions> = {},
  ) {
    const defaults = createDefaultProfileOptions();
    const merged: ProfileRenderOptions = {
      ...defaults,
      ...initialOptions,
      graphLimits: {
        ...defaults.graphLimits,
        ...(initialOptions.graphLimits ?? {}),
      },
    };
    super(canvas, config);
    this.options = merged;
    this.viewport = {
      ...this.viewport,
      ...this.getViewportOptions(),
    };
  }

  getOptions(): ProfileRenderOptions {
    return {
      ...this.options,
      graphLimits: { ...this.options.graphLimits },
    };
  }

  setOutput(output: PhysicsOutput): void {
    this.setData({
      output,
      options: this.getOptions(),
    });
  }

  setOptions(partial: Partial<ProfileRenderOptions>): void {
    const nextGraphLimits = partial.graphLimits
      ? { ...partial.graphLimits }
      : { ...this.options.graphLimits };
    this.options = {
      ...this.options,
      ...partial,
      graphLimits: nextGraphLimits,
    };
    if (this.data) {
      this.setData({
        output: this.data.output,
        options: this.getOptions(),
      });
    } else {
      this.viewport = {
        ...this.viewport,
        ...this.getViewportOptions(),
      };
    }
  }

  setOrientation(orientation: ProfileOrientation): void {
    this.setOptions({ orientation });
  }

  setShowCounterBeam(show: boolean): void {
    this.setOptions({ showCounterBeam: show });
  }

  setShowNozzle(show: boolean): void {
    this.setOptions({ showNozzle: show });
  }

  setGraphLimits(limits: GraphLimits): void {
    this.setOptions({ graphLimits: { ...limits } });
  }

  protected override getViewportOptions(): ViewportOptions {
    const orientation = this.data?.options.orientation ?? this.options?.orientation ?? 'vertical';
    if (orientation === 'horizontal') {
      return {
        lockAspect: true,
        invertY: true,
        padding: { top: 32, right: 28, bottom: 42, left: 68 },
      };
    }
    return {
      lockAspect: true,
      invertY: false,
      padding: { top: 32, right: 28, bottom: 42, left: 68 },
    };
  }

  protected override shouldForceRefitOnDataChange(
    prev: ProfileCanvasData | null,
    next: ProfileCanvasData,
  ): boolean {
    if (!prev) return false;
    const pOpt = prev.options;
    const nOpt = next.options;
    if (pOpt.orientation !== nOpt.orientation) return true;
    if ((pOpt.fitMode ?? 'expand') !== (nOpt.fitMode ?? 'expand')) return true;
    const pLim = pOpt.graphLimits;
    const nLim = nOpt.graphLimits;
    return (
      pLim.zMin_um !== nLim.zMin_um ||
      pLim.zMax_um !== nLim.zMax_um ||
      pLim.rMin_um !== nLim.rMin_um ||
      pLim.rMax_um !== nLim.rMax_um
    );
  }

  protected override shouldRefitOnDataChange(
    prev: ProfileCanvasData | null,
    next: ProfileCanvasData,
  ): boolean {
    if (!prev) return true;
    if (this.shouldForceRefitOnDataChange(prev, next)) return true;
    const pOpt = prev.options;
    const nOpt = next.options;
    return (pOpt.showNozzle ?? true) !== (nOpt.showNozzle ?? true);
  }

  protected override getAutoBounds(data: ProfileCanvasData): WorldBounds {
    const { output, options } = data;
    const s = output.scalars;
    const showNozzle = options.showNozzle ?? true;
    const fitMode = options.fitMode ?? 'expand';
    const lim = normalizeGraphLimits(options.graphLimits);

    const zTop = s.partSurface_um;
    const zBot = zTop + Math.max(0, s.materialThick_um);
    const zNoz1 = s.nozzlePlane1Z_um + s.zShift_um;
    const rNoz = s.nozzleApertureRadius_um;

    let zMin: number;
    let zMax: number;
    let rMin: number;
    let rMax: number;

    if (fitMode === 'exact') {
      zMin = lim.zMin_um;
      zMax = lim.zMax_um;
      rMin = lim.rMin_um;
      rMax = lim.rMax_um;
      if (zMax - zMin < 1e-6) {
        zMin -= 50;
        zMax += 50;
      }
      if (rMax - rMin < 1e-6) {
        rMin -= 50;
        rMax += 50;
      }
    } else {
      const geomZMin = showNozzle ? Math.min(zNoz1 - 200, zTop - 200) : zTop - 300;
      const geomZMax = Math.max(zBot + 200, s.zShift_um + 200);
      const rSpan = Math.max(
        showNozzle ? rNoz * 1.35 : 0,
        s.holeEntranceRadius_um * 1.4,
        s.holeExitRadius_um * 1.4,
        Math.abs(s.rFocus_um) + s.w0_um * 4,
        100,
      );

      zMin = Math.min(geomZMin, lim.zMin_um);
      zMax = Math.max(geomZMax, lim.zMax_um);
      rMin = Math.min(-rSpan, lim.rMin_um);
      rMax = Math.max(rSpan, lim.rMax_um);
    }

    if (options.orientation === 'horizontal') {
      return { minX: zMin, maxX: zMax, minY: rMin, maxY: rMax };
    }
    return { minX: rMin, maxX: rMax, minY: zMin, maxY: zMax };
  }

  private zrToWorld(
    z: number,
    r: number,
    orientation: ProfileOrientation,
  ): Point2D {
    return orientation === 'horizontal' ? { x: z, y: r } : { x: r, y: z };
  }

  private zrToScreen(
    z: number,
    r: number,
    orientation: ProfileOrientation,
  ): Point2D {
    const w = this.zrToWorld(z, r, orientation);
    return worldToScreen(this.viewport, w.x, w.y);
  }

  protected override formatCrosshair(
    worldX: number,
    worldY: number,
  ): { labelX: string; labelY: string } {
    const orientation = this.data?.options.orientation ?? this.options.orientation;
    if (orientation === 'horizontal') {
      return {
        labelX: `Z: ${formatNumberSafe(worldX, 1)} µm`,
        labelY: `R: ${formatNumberSafe(worldY, 1)} µm`,
      };
    }
    return {
      labelX: `R: ${formatNumberSafe(worldX, 1)} µm`,
      labelY: `Z: ${formatNumberSafe(worldY, 1)} µm`,
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
    const orientation = options.orientation;
    const showNozzle = options.showNozzle ?? true;

    const topLeftWorld = screenToWorld(this.viewport, 0, 0);
    const botRightWorld = screenToWorld(this.viewport, width, height);
    const visMinX = Math.min(topLeftWorld.x, botRightWorld.x);
    const visMaxX = Math.max(topLeftWorld.x, botRightWorld.x);
    const visMinY = Math.min(topLeftWorld.y, botRightWorld.y);
    const visMaxY = Math.max(topLeftWorld.y, botRightWorld.y);

    const visMinZ = orientation === 'horizontal' ? visMinX : visMinY;
    const visMaxZ = orientation === 'horizontal' ? visMaxX : visMaxY;
    const visMinR = orientation === 'horizontal' ? visMinY : visMinX;
    const visMaxR = orientation === 'horizontal' ? visMaxY : visMaxX;

    this.drawGrid(
      ctx,
      width,
      height,
      palette,
      orientation,
      visMinX,
      visMaxX,
      visMinY,
      visMaxY,
      visMinZ,
      visMaxZ,
      visMinR,
      visMaxR,
    );

    const outerSpanR = Math.max(
      Math.abs(visMinR),
      Math.abs(visMaxR),
      s.nozzleApertureRadius_um * 2.2,
      s.holeEntranceRadius_um * 1.5,
      s.holeExitRadius_um * 1.5,
      500,
    );

    this.drawWorkpiece(ctx, s, palette, orientation, outerSpanR);

    if (showNozzle) {
      this.drawNozzle(ctx, s, palette, orientation, outerSpanR);
    }

    if (options.showCounterBeam) {
      this.drawBeamSystem(
        ctx,
        output.trepanningProfile,
        palette,
        orientation,
        true,
      );
    }

    this.drawBeamSystem(
      ctx,
      output.trepanningProfile,
      palette,
      orientation,
      false,
    );

    this.drawFocusAndAnnotations(
      ctx,
      s,
      palette,
      orientation,
      visMinR,
      visMaxR,
    );
  }

  private drawGrid(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    palette: ThemePalette,
    orientation: ProfileOrientation,
    visMinX: number,
    visMaxX: number,
    visMinY: number,
    visMaxY: number,
    visMinZ: number,
    visMaxZ: number,
    visMinR: number,
    visMaxR: number,
  ): void {
    ctx.save();
    ctx.strokeStyle = palette.grid;
    ctx.lineWidth = 1;
    ctx.fillStyle = palette.text;
    ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace';

    const xTicks = computeNiceTicks(visMinX, visMaxX, width, 85);
    const yTicks = computeNiceTicks(visMinY, visMaxY, height, 75);

    for (const wx of xTicks.ticks) {
      const p1 = worldToScreen(this.viewport, wx, visMinY);
      const p2 = worldToScreen(this.viewport, wx, visMaxY);
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();

      const axisPrefix = orientation === 'horizontal' ? 'Z' : 'R';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(`${axisPrefix}=${formatNumberSafe(wx, 0)}µm`, p1.x, height - 6);
    }

    for (const wy of yTicks.ticks) {
      const p1 = worldToScreen(this.viewport, visMinX, wy);
      const p2 = worldToScreen(this.viewport, visMaxX, wy);
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();

      const axisPrefix = orientation === 'horizontal' ? 'R' : 'Z';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';
      ctx.fillText(`${axisPrefix}=${formatNumberSafe(wy, 0)}µm`, 8, p1.y - 3);
    }

    // Symmetry axis R = 0
    if (0 >= visMinR - 1e-6 && 0 <= visMaxR + 1e-6) {
      const a1 = this.zrToScreen(visMinZ, 0, orientation);
      const a2 = this.zrToScreen(visMaxZ, 0, orientation);
      ctx.strokeStyle = palette.axis;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(a1.x, a1.y);
      ctx.lineTo(a2.x, a2.y);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.restore();
  }

  private drawWorkpiece(
    ctx: CanvasRenderingContext2D,
    s: PhysicsOutput['scalars'],
    palette: ThemePalette,
    orientation: ProfileOrientation,
    outerR: number,
  ): void {
    ctx.save();
    const zTop = s.partSurface_um;
    const matThk = Math.max(0, s.materialThick_um);
    const zBot = zTop + matThk;
    const rEnt = Math.max(0, s.holeEntranceRadius_um);
    const rExit = Math.max(0, s.holeExitRadius_um);

    if (matThk <= 0) {
      // Degenerate zero-thickness workpiece guard: draw part surface plane & target ticks
      const pLeft = this.zrToScreen(zTop, -outerR, orientation);
      const pRight = this.zrToScreen(zTop, outerR, orientation);
      ctx.strokeStyle = palette.axis;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(pLeft.x, pLeft.y);
      ctx.lineTo(pRight.x, pRight.y);
      ctx.stroke();
      ctx.setLineDash([]);

      const entL = this.zrToScreen(zTop, -rEnt, orientation);
      const entR = this.zrToScreen(zTop, rEnt, orientation);
      ctx.strokeStyle = palette.holeWall;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(entL.x, entL.y);
      ctx.lineTo(entR.x, entR.y);
      ctx.stroke();

      ctx.restore();
      return;
    }

    const blockOuterR = Math.max(outerR, rEnt + 200, rExit + 200);
    ctx.fillStyle = palette.surface;
    ctx.strokeStyle = palette.axis;
    ctx.lineWidth = 1.25;

    // Right solid block
    const r1 = this.zrToScreen(zTop, blockOuterR, orientation);
    const r2 = this.zrToScreen(zTop, rEnt, orientation);
    const r3 = this.zrToScreen(zBot, rExit, orientation);
    const r4 = this.zrToScreen(zBot, blockOuterR, orientation);
    ctx.beginPath();
    ctx.moveTo(r1.x, r1.y);
    ctx.lineTo(r2.x, r2.y);
    ctx.lineTo(r3.x, r3.y);
    ctx.lineTo(r4.x, r4.y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Left solid block
    const l1 = this.zrToScreen(zTop, -blockOuterR, orientation);
    const l2 = this.zrToScreen(zTop, -rEnt, orientation);
    const l3 = this.zrToScreen(zBot, -rExit, orientation);
    const l4 = this.zrToScreen(zBot, -blockOuterR, orientation);
    ctx.beginPath();
    ctx.moveTo(l1.x, l1.y);
    ctx.lineTo(l2.x, l2.y);
    ctx.lineTo(l3.x, l3.y);
    ctx.lineTo(l4.x, l4.y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Tapered target hole walls
    ctx.strokeStyle = palette.holeWall;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(r2.x, r2.y);
    ctx.lineTo(r3.x, r3.y);
    ctx.moveTo(l2.x, l2.y);
    ctx.lineTo(l3.x, l3.y);
    ctx.stroke();

    // Wall overcut highlight
    if (s.wallOvercut) {
      ctx.strokeStyle = palette.overcut;
      ctx.lineWidth = 5;
      ctx.globalAlpha = 0.45;
      ctx.beginPath();
      ctx.moveTo(r2.x, r2.y);
      ctx.lineTo(r3.x, r3.y);
      ctx.moveTo(l2.x, l2.y);
      ctx.lineTo(l3.x, l3.y);
      ctx.stroke();
      ctx.globalAlpha = 1;

      ctx.setLineDash([6, 4]);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(r2.x, r2.y);
      ctx.lineTo(r3.x, r3.y);
      ctx.moveTo(l2.x, l2.y);
      ctx.lineTo(l3.x, l3.y);
      ctx.stroke();
      ctx.setLineDash([]);

      const midZ = (zTop + zBot) / 2;
      const midR = (rEnt + rExit) / 2;
      const lblPt = this.zrToScreen(midZ, midR, orientation);
      ctx.fillStyle = palette.overcut;
      ctx.font = 'bold 11px system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(
        `OVERCUT +${formatNumberSafe(s.maxOvercut_um, 1)} µm`,
        lblPt.x + 8,
        lblPt.y,
      );
    }

    ctx.restore();
  }

  private drawNozzle(
    ctx: CanvasRenderingContext2D,
    s: PhysicsOutput['scalars'],
    palette: ThemePalette,
    orientation: ProfileOrientation,
    outerR: number,
  ): void {
    ctx.save();
    // Exact part-frame Z alignment: trepanningPath planeZ is focus-referenced, so add zShift_um
    const zNoz1 = s.nozzlePlane1Z_um + s.zShift_um;
    const zNoz2 = s.nozzlePlane2Z_um + s.zShift_um;
    const rNoz = Math.max(0, s.nozzleApertureRadius_um);
    const nozzleOuterR = Math.max(rNoz * 2.2, rNoz + 600, outerR * 0.9);

    const exit1Clipped = s.exitAperture1MaxR_um >= rNoz;
    const exit2Clipped = s.exitAperture2MaxR_um >= rNoz;
    const isClipping = s.nozzleClipping || exit1Clipped || exit2Clipped;

    // Right and Left 2-plane nozzle bore blocks
    ctx.fillStyle = palette.nozzleFill;
    ctx.strokeStyle = isClipping ? palette.clipping : palette.nozzleStroke;
    ctx.lineWidth = isClipping ? 2.2 : 1.5;

    for (const sign of [1, -1] as const) {
      const p1 = this.zrToScreen(zNoz1, sign * rNoz, orientation);
      const p2 = this.zrToScreen(zNoz1, sign * nozzleOuterR, orientation);
      const p3 = this.zrToScreen(zNoz2, sign * nozzleOuterR, orientation);
      const p4 = this.zrToScreen(zNoz2, sign * rNoz, orientation);
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.lineTo(p3.x, p3.y);
      ctx.lineTo(p4.x, p4.y);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }

    // Exit Aperture 1 plane bar
    const e1L = this.zrToScreen(zNoz1, -rNoz, orientation);
    const e1R = this.zrToScreen(zNoz1, rNoz, orientation);
    ctx.strokeStyle = exit1Clipped ? palette.clipping : palette.nozzleAperture;
    ctx.lineWidth = exit1Clipped ? 3 : 2;
    ctx.setLineDash([6, 3]);
    ctx.beginPath();
    ctx.moveTo(e1L.x, e1L.y);
    ctx.lineTo(e1R.x, e1R.y);
    ctx.stroke();

    // Exit Aperture 2 plane bar (nozzle tip)
    const e2L = this.zrToScreen(zNoz2, -rNoz, orientation);
    const e2R = this.zrToScreen(zNoz2, rNoz, orientation);
    ctx.strokeStyle = exit2Clipped ? palette.clipping : palette.nozzleAperture;
    ctx.lineWidth = exit2Clipped ? 3 : 2;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(e2L.x, e2L.y);
    ctx.lineTo(e2R.x, e2R.y);
    ctx.stroke();

    // Nozzle Labels
    const lbl1 = this.zrToScreen(zNoz1, 0, orientation);
    const lbl2 = this.zrToScreen(zNoz2, 0, orientation);
    ctx.font = 'bold 11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = exit1Clipped ? palette.clipping : palette.text;
    ctx.fillText(
      `Exit 1: ⌀${formatNumberSafe((2 * s.exitAperture1MaxR_um) / 1000, 2)} mm`,
      lbl1.x,
      lbl1.y - 8,
    );

    ctx.fillStyle = isClipping ? palette.clipping : palette.textBright;
    ctx.fillText(
      `Nozzle Aperture ⌀${formatNumberSafe((2 * rNoz) / 1000, 2)} mm (Exit 2: ⌀${formatNumberSafe((2 * s.exitAperture2MaxR_um) / 1000, 2)} mm)`,
      lbl2.x,
      lbl2.y - 8,
    );

    if (isClipping) {
      ctx.fillStyle = palette.clipping;
      ctx.fillText('NOZZLE CLIPPING', lbl2.x, lbl2.y + 14);
    }

    ctx.restore();
  }

  private readCurvePoint(
    profile: Float64Array,
    k: number,
    curveIdx: number,
    mirrored: boolean,
  ): { z: number; r: number } | null {
    const base = k * PROFILE_STRIDE + curveIdx * 2;
    const z = profile[base];
    const r = profile[base + 1];
    if (!Number.isFinite(z) || !Number.isFinite(r)) {
      return null;
    }
    return mirrored ? mirrorCounterBeam(z, r) : { z, r };
  }

  private fillPairedCurves(
    ctx: CanvasRenderingContext2D,
    profile: Float64Array,
    curveA: number,
    curveB: number,
    orientation: ProfileOrientation,
    mirrored: boolean,
    fillStyle: string,
  ): void {
    ctx.fillStyle = fillStyle;
    let start = -1;

    const flushSpan = (sIdx: number, eIdx: number) => {
      if (eIdx - sIdx < 1) return;
      ctx.beginPath();
      for (let k = sIdx; k <= eIdx; k++) {
        const pt = this.readCurvePoint(profile, k, curveA, mirrored)!;
        const sc = this.zrToScreen(pt.z, pt.r, orientation);
        if (k === sIdx) ctx.moveTo(sc.x, sc.y);
        else ctx.lineTo(sc.x, sc.y);
      }
      for (let k = eIdx; k >= sIdx; k--) {
        const pt = this.readCurvePoint(profile, k, curveB, mirrored)!;
        const sc = this.zrToScreen(pt.z, pt.r, orientation);
        ctx.lineTo(sc.x, sc.y);
      }
      ctx.closePath();
      ctx.fill();
    };

    for (let k = 0; k < PROFILE_POINTS; k++) {
      const pA = this.readCurvePoint(profile, k, curveA, mirrored);
      const pB = this.readCurvePoint(profile, k, curveB, mirrored);
      if (pA && pB) {
        if (start === -1) start = k;
      } else if (start !== -1) {
        flushSpan(start, k - 1);
        start = -1;
      }
    }
    if (start !== -1) {
      flushSpan(start, PROFILE_POINTS - 1);
    }
  }

  private drawBeamSystem(
    ctx: CanvasRenderingContext2D,
    profile: Float64Array,
    palette: ThemePalette,
    orientation: ProfileOrientation,
    mirrored: boolean,
  ): void {
    ctx.save();

    const waistFill = mirrored ? palette.ghostBeamFill : palette.beamWaistFill;
    const waistStroke = mirrored ? palette.ghostBeamWaist : palette.beamWaist;
    const ablFill = mirrored ? palette.ghostAblationFill : palette.ablationFill;
    const ablStroke = mirrored ? palette.ghostAblation : palette.ablation;

    // 1. 1/e² Waist envelopes: Forward (4, 5) and Backward (6, 7)
    this.fillPairedCurves(
      ctx,
      profile,
      PROFILE_CURVE.FWD_TOP_RIGHT_W,
      PROFILE_CURVE.FWD_BOT_RIGHT_W,
      orientation,
      mirrored,
      waistFill,
    );
    this.fillPairedCurves(
      ctx,
      profile,
      PROFILE_CURVE.BWD_BOT_LEFT_W,
      PROFILE_CURVE.BWD_TOP_LEFT_W,
      orientation,
      mirrored,
      waistFill,
    );

    ctx.strokeStyle = waistStroke;
    ctx.lineWidth = mirrored ? 1.25 : 1.75;
    if (mirrored) ctx.setLineDash([4, 3]);
    for (const c of [
      PROFILE_CURVE.FWD_TOP_RIGHT_W,
      PROFILE_CURVE.FWD_BOT_RIGHT_W,
      PROFILE_CURVE.BWD_BOT_LEFT_W,
      PROFILE_CURVE.BWD_TOP_LEFT_W,
    ]) {
      strokePolylineWithNaNBreaks(ctx, PROFILE_POINTS, (k) => {
        const pt = this.readCurvePoint(profile, k, c, mirrored);
        return pt ? this.zrToScreen(pt.z, pt.r, orientation) : null;
      });
    }
    ctx.setLineDash([]);

    // 2. Ablation envelopes: Forward (0, 1) and Backward (2, 3)
    this.fillPairedCurves(
      ctx,
      profile,
      PROFILE_CURVE.FWD_TOP_RIGHT_ABL,
      PROFILE_CURVE.FWD_BOT_RIGHT_ABL,
      orientation,
      mirrored,
      ablFill,
    );
    this.fillPairedCurves(
      ctx,
      profile,
      PROFILE_CURVE.BWD_BOT_LEFT_ABL,
      PROFILE_CURVE.BWD_TOP_LEFT_ABL,
      orientation,
      mirrored,
      ablFill,
    );

    ctx.strokeStyle = ablStroke;
    ctx.lineWidth = mirrored ? 1.25 : 2;
    if (mirrored) ctx.setLineDash([4, 3]);
    for (const c of [
      PROFILE_CURVE.FWD_TOP_RIGHT_ABL,
      PROFILE_CURVE.FWD_BOT_RIGHT_ABL,
      PROFILE_CURVE.BWD_BOT_LEFT_ABL,
      PROFILE_CURVE.BWD_TOP_LEFT_ABL,
    ]) {
      strokePolylineWithNaNBreaks(ctx, PROFILE_POINTS, (k) => {
        const pt = this.readCurvePoint(profile, k, c, mirrored);
        return pt ? this.zrToScreen(pt.z, pt.r, orientation) : null;
      });
    }
    ctx.setLineDash([]);

    // 3. Optical centerline (midpoint of paired waist curves)
    ctx.strokeStyle = palette.opticalAxis;
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 5]);
    for (const [cA, cB] of [
      [PROFILE_CURVE.FWD_TOP_RIGHT_W, PROFILE_CURVE.FWD_BOT_RIGHT_W],
      [PROFILE_CURVE.BWD_BOT_LEFT_W, PROFILE_CURVE.BWD_TOP_LEFT_W],
    ] as const) {
      strokePolylineWithNaNBreaks(ctx, PROFILE_POINTS, (k) => {
        const pA = this.readCurvePoint(profile, k, cA, mirrored);
        const pB = this.readCurvePoint(profile, k, cB, mirrored);
        if (!pA || !pB) return null;
        return this.zrToScreen(
          (pA.z + pB.z) / 2,
          (pA.r + pB.r) / 2,
          orientation,
        );
      });
    }
    ctx.setLineDash([]);

    ctx.restore();
  }

  private drawFocusAndAnnotations(
    ctx: CanvasRenderingContext2D,
    s: PhysicsOutput['scalars'],
    palette: ThemePalette,
    orientation: ProfileOrientation,
    visMinR: number,
    visMaxR: number,
  ): void {
    ctx.save();
    // Focus plane indicator (Z = zShift_um in part frame)
    const f1 = this.zrToScreen(s.zShift_um, visMinR, orientation);
    const f2 = this.zrToScreen(s.zShift_um, visMaxR, orientation);
    ctx.strokeStyle = palette.accent;
    ctx.lineWidth = 1.25;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(f1.x, f1.y);
    ctx.lineTo(f2.x, f2.y);
    ctx.stroke();
    ctx.setLineDash([]);

    const focusLbl = this.zrToScreen(s.zShift_um, s.rFocus_um, orientation);
    ctx.fillStyle = palette.accent;
    ctx.font = 'bold 11px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(
      `Focus Z=${formatNumberSafe(s.zShift_um, 0)} µm`,
      focusLbl.x + 8,
      focusLbl.y - 6,
    );

    // Attack angle readout
    const attackDeg = (s.attackAngle_rad * 180) / Math.PI;
    ctx.fillStyle = palette.warning;
    ctx.fillText(
      `θ = ${formatNumberSafe(attackDeg, 2)}°`,
      focusLbl.x + 8,
      focusLbl.y + 12,
    );

    // Entrance & Exit diameter labels
    const entLbl = this.zrToScreen(
      s.partSurface_um,
      s.holeEntranceRadius_um,
      orientation,
    );
    ctx.fillStyle = palette.textBright;
    ctx.font = '11px system-ui, sans-serif';
    ctx.fillText(
      `Ent ⌀${formatNumberSafe(s.holeEntranceRadius_um * 2, 1)} µm`,
      entLbl.x + 6,
      entLbl.y - 6,
    );

    if (s.materialThick_um > 0) {
      const exitLbl = this.zrToScreen(
        s.partSurface_um + s.materialThick_um,
        s.holeExitRadius_um,
        orientation,
      );
      ctx.fillText(
        `Exit ⌀${formatNumberSafe(s.holeExitRadius_um * 2, 1)} µm`,
        exitLbl.x + 6,
        exitLbl.y + 14,
      );
    }

    ctx.restore();
  }

  getSummaryTable(): SummaryTableSpec {
    if (!this.data) {
      return {
        caption: 'Trepanning Cross-Section Summary (Chart 2)',
        headers: ['Metric', 'Value', 'Unit'],
        rows: [['Status', 'Awaiting calculation', '—']],
      };
    }

    const s = this.data.output.scalars;
    const attackDeg = (s.attackAngle_rad * 180) / Math.PI;
    const zNoz1 = s.nozzlePlane1Z_um + s.zShift_um;
    const zNoz2 = s.nozzlePlane2Z_um + s.zShift_um;

    return {
      caption: 'Trepanning Cross-Section Summary (Chart 2)',
      headers: ['Metric', 'Value', 'Unit'],
      rows: [
        ['Entrance Diameter', formatNumberSafe(s.holeEntranceRadius_um * 2, 2), 'µm'],
        ['Exit Diameter', formatNumberSafe(s.holeExitRadius_um * 2, 2), 'µm'],
        ['Material Thickness', formatNumberSafe(s.materialThick_um, 1), 'µm'],
        ['Part Surface Z', formatNumberSafe(s.partSurface_um, 1), 'µm'],
        ['Focus Z Shift (Part Frame)', formatNumberSafe(s.zShift_um, 1), 'µm'],
        ['Effective Scan Radius (r_focus)', formatNumberSafe(s.rFocus_um, 2), 'µm'],
        ['Effective Attack Angle', formatNumberSafe(attackDeg, 3), 'deg'],
        ['Nozzle Plane 1 Z / Max Beam ⌀', `${formatNumberSafe(zNoz1, 0)} µm / ${formatNumberSafe((2 * s.exitAperture1MaxR_um) / 1000, 3)} mm`, 'mixed'],
        ['Nozzle Plane 2 Z / Max Beam ⌀', `${formatNumberSafe(zNoz2, 0)} µm / ${formatNumberSafe((2 * s.exitAperture2MaxR_um) / 1000, 3)} mm`, 'mixed'],
        ['Nozzle Aperture Diameter', formatNumberSafe(s.nozzleApertureRadius_um * 2 / 1000, 3), 'mm'],
        ['Nozzle Clipping', s.nozzleClipping ? 'Yes (CLIPPING)' : 'No (Clear)', 'status'],
        [
          'Wall Overcut',
          s.wallOvercut
            ? `Yes (+${formatNumberSafe(s.maxOvercut_um, 2)} µm)`
            : 'No (Clear)',
          'status',
        ],
      ],
    };
  }
}
