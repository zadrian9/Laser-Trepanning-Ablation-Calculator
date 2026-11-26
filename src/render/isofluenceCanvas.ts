/**
 * Tab 3 — Chart 1: Isofluence Lines Canvas Renderer.
 * Plots 1,001-point symmetric contour pairs (±w(z), ±(0.135..0.9) I0, ±Ablation I,
 * ±Thermal Damage I/64) over z in [0, zMax], skipping N_SPACER=11, breaking cleanly
 * on NaN cutoffs, with per-contour toggles and edge-guarded live Z From Focus marker.
 */

import {
  ISO_COL,
  ISO_POINTS,
  ISO_STRIDE,
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

export type IsofluenceContourKey =
  | 'waist'
  | 'f0135'
  | 'f020'
  | 'f030'
  | 'f040'
  | 'f050'
  | 'f070'
  | 'f090'
  | 'ablation'
  | 'thermalDamage';

export type IsofluenceVisibility = Record<IsofluenceContourKey, boolean>;

export interface IsofluenceRenderOptions {
  zFromFocusLookup_um: number;
  visibleContours: IsofluenceVisibility;
}

export interface IsofluenceCanvasData {
  output: PhysicsOutput;
  options: IsofluenceRenderOptions;
}

export const DEFAULT_ISOFLUENCE_VISIBILITY: Readonly<IsofluenceVisibility> = {
  waist: true,
  f0135: true,
  f020: true,
  f030: true,
  f040: true,
  f050: true,
  f070: true,
  f090: true,
  ablation: true,
  thermalDamage: true,
};

interface ContourDescriptor {
  key: IsofluenceContourKey;
  label: string;
  posCol: number;
  negCol: number;
  lineWidth: number;
  dashed: boolean;
  colorFromPalette: (palette: ThemePalette) => string;
}

const CONTOUR_DESCRIPTORS: readonly ContourDescriptor[] = [
  {
    key: 'thermalDamage',
    label: 'Thermal Damage (I/64)',
    posCol: ISO_COL.POS_THERM,
    negCol: ISO_COL.NEG_THERM,
    lineWidth: 1.75,
    dashed: true,
    colorFromPalette: (p) => p.thermalDamage,
  },
  {
    key: 'f0135',
    label: '0.135 I₀',
    posCol: ISO_COL.POS_0135,
    negCol: ISO_COL.NEG_0135,
    lineWidth: 1.25,
    dashed: false,
    colorFromPalette: (p) => p.isoLevels[0],
  },
  {
    key: 'f020',
    label: '0.20 I₀',
    posCol: ISO_COL.POS_020,
    negCol: ISO_COL.NEG_020,
    lineWidth: 1.25,
    dashed: false,
    colorFromPalette: (p) => p.isoLevels[1],
  },
  {
    key: 'f030',
    label: '0.30 I₀',
    posCol: ISO_COL.POS_030,
    negCol: ISO_COL.NEG_030,
    lineWidth: 1.25,
    dashed: false,
    colorFromPalette: (p) => p.isoLevels[2],
  },
  {
    key: 'f040',
    label: '0.40 I₀',
    posCol: ISO_COL.POS_040,
    negCol: ISO_COL.NEG_040,
    lineWidth: 1.25,
    dashed: false,
    colorFromPalette: (p) => p.isoLevels[3],
  },
  {
    key: 'f050',
    label: '0.50 I₀',
    posCol: ISO_COL.POS_050,
    negCol: ISO_COL.NEG_050,
    lineWidth: 1.25,
    dashed: false,
    colorFromPalette: (p) => p.isoLevels[4],
  },
  {
    key: 'f070',
    label: '0.70 I₀',
    posCol: ISO_COL.POS_070,
    negCol: ISO_COL.NEG_070,
    lineWidth: 1.25,
    dashed: false,
    colorFromPalette: (p) => p.isoLevels[5],
  },
  {
    key: 'f090',
    label: '0.90 I₀',
    posCol: ISO_COL.POS_090,
    negCol: ISO_COL.NEG_090,
    lineWidth: 1.25,
    dashed: false,
    colorFromPalette: (p) => p.isoLevels[6],
  },
  {
    key: 'waist',
    label: '1/e² Waist w(z)',
    posCol: ISO_COL.POS_W,
    negCol: ISO_COL.NEG_W,
    lineWidth: 2,
    dashed: false,
    colorFromPalette: (p) => p.beamWaist,
  },
  {
    key: 'ablation',
    label: 'Ablation Threshold (I)',
    posCol: ISO_COL.POS_ABL,
    negCol: ISO_COL.NEG_ABL,
    lineWidth: 2.5,
    dashed: false,
    colorFromPalette: (p) => p.ablation,
  },
];

export function createDefaultIsofluenceOptions(): IsofluenceRenderOptions {
  return {
    zFromFocusLookup_um: 0,
    visibleContours: { ...DEFAULT_ISOFLUENCE_VISIBILITY },
  };
}

export class IsofluenceCanvasRenderer extends BaseInteractiveCanvas<IsofluenceCanvasData> {
  private options: IsofluenceRenderOptions;

  constructor(
    canvas: HTMLCanvasElement,
    config: BaseCanvasConfig = {},
    initialOptions: Partial<IsofluenceRenderOptions> = {},
  ) {
    const defaults = createDefaultIsofluenceOptions();
    super(canvas, config);
    this.options = {
      zFromFocusLookup_um:
        initialOptions.zFromFocusLookup_um ?? defaults.zFromFocusLookup_um,
      visibleContours: {
        ...defaults.visibleContours,
        ...(initialOptions.visibleContours ?? {}),
      },
    };
  }

  getOptions(): IsofluenceRenderOptions {
    return {
      zFromFocusLookup_um: this.options.zFromFocusLookup_um,
      visibleContours: { ...this.options.visibleContours },
    };
  }

  setOutput(output: PhysicsOutput): void {
    this.setData({
      output,
      options: this.getOptions(),
    });
  }

  setOptions(partial: Partial<IsofluenceRenderOptions>): void {
    this.options = {
      zFromFocusLookup_um:
        partial.zFromFocusLookup_um ?? this.options.zFromFocusLookup_um,
      visibleContours: partial.visibleContours
        ? { ...this.options.visibleContours, ...partial.visibleContours }
        : { ...this.options.visibleContours },
    };
    if (this.data) {
      this.setData({
        output: this.data.output,
        options: this.getOptions(),
      });
    }
  }

  setContourVisible(key: IsofluenceContourKey, visible: boolean): void {
    this.setOptions({
      visibleContours: {
        ...this.options.visibleContours,
        [key]: visible,
      },
    });
  }

  setZFromFocus(z_um: number): void {
    this.setOptions({ zFromFocusLookup_um: z_um });
  }

  protected override getViewportOptions(): ViewportOptions {
    return {
      lockAspect: false,
      invertY: true,
      padding: { top: 28, right: 24, bottom: 40, left: 64 },
    };
  }

  protected override getAutoBounds(data: IsofluenceCanvasData): WorldBounds {
    const { output, options } = data;
    const s = output.scalars;
    const iso = output.isofluence;

    const zMax = Math.max(
      Number.isFinite(s.zMaxIsofluence_um) ? s.zMaxIsofluence_um : 1000,
      10,
    );

    let maxR = 0;
    for (const desc of CONTOUR_DESCRIPTORS) {
      if (!options.visibleContours[desc.key]) continue;
      for (let i = 0; i < ISO_POINTS; i++) {
        const base = i * ISO_STRIDE;
        const rPos = iso[base + desc.posCol];
        const rNeg = iso[base + desc.negCol];
        if (Number.isFinite(rPos)) {
          const ar = Math.abs(rPos);
          if (ar > maxR) maxR = ar;
        }
        if (Number.isFinite(rNeg)) {
          const ar = Math.abs(rNeg);
          if (ar > maxR) maxR = ar;
        }
      }
    }

    if (maxR <= 0) {
      maxR = Math.max(Number.isFinite(s.w0_um) ? s.w0_um * 4 : 0, 20);
    }

    const rLimit = maxR * 1.15;
    return {
      minX: 0,
      maxX: zMax,
      minY: -rLimit,
      maxY: rLimit,
    };
  }

  protected override formatCrosshair(
    worldX: number,
    worldY: number,
  ): { labelX: string; labelY: string } {
    return {
      labelX: `Z: ${formatNumberSafe(worldX, 1)} µm`,
      labelY: `R: ${formatNumberSafe(worldY, 2)} µm`,
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

    const tl = screenToWorld(this.viewport, 0, 0);
    const br = screenToWorld(this.viewport, width, height);
    const visMinZ = Math.min(tl.x, br.x);
    const visMaxZ = Math.max(tl.x, br.x);
    const visMinR = Math.min(tl.y, br.y);
    const visMaxR = Math.max(tl.y, br.y);

    this.drawGridAndAxes(
      ctx,
      width,
      height,
      palette,
      visMinZ,
      visMaxZ,
      visMinR,
      visMaxR,
    );

    this.drawContours(ctx, output.isofluence, options.visibleContours, palette);

    this.drawZLookupMarker(
      ctx,
      width,
      height,
      output,
      options.zFromFocusLookup_um,
      visMinZ,
      visMaxZ,
      palette,
    );
  }

  private drawGridAndAxes(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    palette: ThemePalette,
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

    const zTicks = computeNiceTicks(visMinZ, visMaxZ, width, 85);
    const rTicks = computeNiceTicks(visMinR, visMaxR, height, 65);

    for (const z of zTicks.ticks) {
      const p1 = worldToScreen(this.viewport, z, visMinR);
      const p2 = worldToScreen(this.viewport, z, visMaxR);
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();

      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(`Z=${formatNumberSafe(z, 0)}µm`, p1.x, height - 6);
    }

    for (const r of rTicks.ticks) {
      const p1 = worldToScreen(this.viewport, visMinZ, r);
      const p2 = worldToScreen(this.viewport, visMaxZ, r);
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();

      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';
      ctx.fillText(`R=${formatNumberSafe(r, 1)}µm`, 8, p1.y - 3);
    }

    // Optical centerline R = 0
    if (0 >= visMinR && 0 <= visMaxR) {
      const a1 = worldToScreen(this.viewport, visMinZ, 0);
      const a2 = worldToScreen(this.viewport, visMaxZ, 0);
      ctx.strokeStyle = palette.axis;
      ctx.lineWidth = 1.25;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(a1.x, a1.y);
      ctx.lineTo(a2.x, a2.y);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.restore();
  }

  private drawContours(
    ctx: CanvasRenderingContext2D,
    iso: Float64Array,
    visible: IsofluenceVisibility,
    palette: ThemePalette,
  ): void {
    ctx.save();

    for (const desc of CONTOUR_DESCRIPTORS) {
      if (!visible[desc.key]) continue;
      ctx.strokeStyle = desc.colorFromPalette(palette);
      ctx.lineWidth = desc.lineWidth;
      ctx.setLineDash(desc.dashed ? [6, 4] : []);

      // Positive half
      strokePolylineWithNaNBreaks(ctx, ISO_POINTS, (i) => {
        const base = i * ISO_STRIDE;
        const z = iso[base + ISO_COL.Z];
        const r = iso[base + desc.posCol];
        if (!Number.isFinite(z) || !Number.isFinite(r)) return null;
        return worldToScreen(this.viewport, z, r);
      });

      // Negative half
      strokePolylineWithNaNBreaks(ctx, ISO_POINTS, (i) => {
        const base = i * ISO_STRIDE;
        const z = iso[base + ISO_COL.Z];
        const r = iso[base + desc.negCol];
        if (!Number.isFinite(z) || !Number.isFinite(r)) return null;
        return worldToScreen(this.viewport, z, r);
      });
    }

    ctx.setLineDash([]);
    ctx.restore();
  }

  private drawZLookupMarker(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    output: PhysicsOutput,
    zLookupRaw: number,
    visMinZ: number,
    visMaxZ: number,
    palette: ThemePalette,
  ): void {
    if (!Number.isFinite(zLookupRaw)) return;

    ctx.save();
    const ablatedDia = output.scalars.ablatedSpotAtLookupZ_um;
    const hasAblation = Number.isFinite(ablatedDia) && ablatedDia > 0;
    const callout = hasAblation
      ? `Z=${formatNumberSafe(zLookupRaw, 1)} µm | Ablated ⌀ ${formatNumberSafe(ablatedDia, 2)} µm`
      : `Z=${formatNumberSafe(zLookupRaw, 1)} µm | No ablation at Z`;

    if (zLookupRaw >= visMinZ && zLookupRaw <= visMaxZ) {
      const markerTop = worldToScreen(this.viewport, zLookupRaw, 0);
      ctx.strokeStyle = palette.accent;
      ctx.lineWidth = 1.75;
      ctx.setLineDash([5, 3]);
      ctx.beginPath();
      ctx.moveTo(markerTop.x, 10);
      ctx.lineTo(markerTop.x, height - 24);
      ctx.stroke();
      ctx.setLineDash([]);

      if (hasAblation) {
        const rAbl = ablatedDia / 2;
        const pPos = worldToScreen(this.viewport, zLookupRaw, rAbl);
        const pNeg = worldToScreen(this.viewport, zLookupRaw, -rAbl);
        ctx.fillStyle = palette.ablation;
        ctx.beginPath();
        ctx.arc(pPos.x, pPos.y, 4, 0, Math.PI * 2);
        ctx.arc(pNeg.x, pNeg.y, 4, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.font = 'bold 11px system-ui, sans-serif';
      const tw = ctx.measureText?.(callout)?.width ?? callout.length * 6.5;
      const boxW = tw + 14;
      const boxH = 22;
      const boxX = Math.max(8, Math.min(width - boxW - 8, markerTop.x - boxW / 2));
      const boxY = 10;

      ctx.fillStyle = palette.pillBg;
      ctx.strokeStyle = palette.accent;
      ctx.lineWidth = 1;
      ctx.fillRect(boxX, boxY, boxW, boxH);
      ctx.strokeRect(boxX, boxY, boxW, boxH);

      ctx.fillStyle = palette.textBright;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(callout, boxX + 7, boxY + boxH / 2);
    } else {
      // Edge-pinned badge when zLookup is outside visible Z span (e.g. Z = 9999 or Z < 0)
      const isRight = zLookupRaw > visMaxZ;
      const badge = isRight ? `${callout} >` : `< ${callout}`;
      ctx.font = 'bold 11px system-ui, sans-serif';
      const tw = ctx.measureText?.(badge)?.width ?? badge.length * 6.5;
      const boxW = tw + 14;
      const boxH = 22;
      const boxX = isRight ? Math.max(8, width - boxW - 10) : 10;
      const boxY = 10;

      ctx.fillStyle = palette.pillBg;
      ctx.strokeStyle = palette.warning;
      ctx.lineWidth = 1.25;
      ctx.fillRect(boxX, boxY, boxW, boxH);
      ctx.strokeRect(boxX, boxY, boxW, boxH);

      ctx.fillStyle = palette.textBright;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(badge, boxX + 7, boxY + boxH / 2);
    }

    ctx.restore();
  }

  private findMaxFiniteZForColumn(iso: Float64Array, col: number): number | null {
    let maxZ: number | null = null;
    for (let i = 0; i < ISO_POINTS; i++) {
      const base = i * ISO_STRIDE;
      const z = iso[base + ISO_COL.Z];
      const r = iso[base + col];
      if (Number.isFinite(z) && Number.isFinite(r)) {
        if (maxZ === null || z > maxZ) {
          maxZ = z;
        }
      }
    }
    return maxZ;
  }

  getSummaryTable(): SummaryTableSpec {
    if (!this.data) {
      return {
        caption: 'Isofluence Contours & Axial Lookup Summary (Chart 1)',
        headers: ['Parameter', 'Value', 'Unit'],
        rows: [['Status', 'Awaiting calculation', '—']],
      };
    }

    const { output, options } = this.data;
    const s = output.scalars;
    const iso = output.isofluence;

    const ablatedAtZ =
      Number.isFinite(s.ablatedSpotAtLookupZ_um) && s.ablatedSpotAtLookupZ_um > 0
        ? formatNumberSafe(s.ablatedSpotAtLookupZ_um, 2)
        : 'No ablation';

    const maxAblZ = this.findMaxFiniteZForColumn(iso, ISO_COL.POS_ABL);
    const maxThermZ = this.findMaxFiniteZForColumn(iso, ISO_COL.POS_THERM);

    return {
      caption: 'Isofluence Contours & Axial Lookup Summary (Chart 1)',
      headers: ['Parameter', 'Value', 'Unit'],
      rows: [
        ['Axial Plot Range (z_max)', formatNumberSafe(s.zMaxIsofluence_um, 1), 'µm'],
        ['Beam Waist Radius (w₀)', formatNumberSafe(s.w0_um, 3), 'µm'],
        ['Rayleigh Range (z_R)', formatNumberSafe(s.rayleighRange_um, 2), 'µm'],
        ['Z From Focus Lookup', formatNumberSafe(options.zFromFocusLookup_um, 1), 'µm'],
        [
          'Ablated Spot ⌀ at Z',
          ablatedAtZ,
          Number.isFinite(s.ablatedSpotAtLookupZ_um) && s.ablatedSpotAtLookupZ_um > 0
            ? 'µm'
            : 'status',
        ],
        [
          'Max Ablation Axial Reach (I)',
          maxAblZ !== null ? formatNumberSafe(maxAblZ, 1) : 'No ablation',
          maxAblZ !== null ? 'µm' : 'status',
        ],
        [
          'Max Thermal Damage Reach (I/64)',
          maxThermZ !== null ? formatNumberSafe(maxThermZ, 1) : 'No thermal damage',
          maxThermZ !== null ? 'µm' : 'status',
        ],
      ],
    };
  }
}
