/**
 * 1,001-point Isofluence Lines (`IsofluenceCalcs!C2:X1002`) over z in [0, z_max].
 * Columns 0..21 map 1:1 to Excel C..X (col 11 = N spacer = NaN).
 */

import {
  ISO_COL,
  ISO_LEN,
  ISO_POINTS,
  ISO_STRIDE,
} from '../types/physics.ts';

export const ISOFLUENCE_FRACTIONS = [
  0.135,
  0.2,
  0.3,
  0.4,
  0.5,
  0.7,
  0.9,
] as const;

export function computeIsofluenceZMax(
  materialThick_um: number,
  partSurface_Z_um: number,
  focusRelZ_um: number,
  zShift_um: number,
): number {
  const a = Math.abs(materialThick_um + partSurface_Z_um - focusRelZ_um);
  const b = Math.abs(partSurface_Z_um - focusRelZ_um);
  return (a > b ? a : b) * 1.1 + Math.abs(zShift_um);
}

function negNoZero(v: number): number {
  if (Number.isNaN(v)) return Number.NaN;
  return v === 0 ? 0 : -v;
}

export function computeIsofluenceRadiusForIntensity(
  w0_um: number,
  w_z_um: number,
  peakFluence_J_cm2: number,
  targetIntensity_J_cm2: number,
): number {
  if (
    w0_um <= 0 ||
    w_z_um <= 0 ||
    peakFluence_J_cm2 <= 0 ||
    targetIntensity_J_cm2 <= 0
  ) {
    return Number.NaN;
  }
  const wRatio = w0_um / w_z_um;
  const iz = peakFluence_J_cm2 * wRatio * wRatio;
  const arg = Math.log(iz / targetIntensity_J_cm2);
  if (arg < 0) return Number.NaN;
  return Math.sqrt(((w_z_um * w_z_um) / 2) * arg);
}

export function computeIsofluenceLines(
  w0_um: number,
  rayleighRange_um: number,
  peakFluence_J_cm2: number,
  ablationThreshold_J_cm2: number,
  zMax_um: number,
  out: Float64Array = new Float64Array(ISO_LEN),
): Float64Array {
  const zStep = zMax_um / 1000;
  const thermThresh = ablationThreshold_J_cm2 / 64;
  const validBeam = w0_um > 0 && rayleighRange_um > 0;

  for (let i = 0; i < ISO_POINTS; i++) {
    const base = i * ISO_STRIDE;
    const z = i * zStep;
    const wz = validBeam
      ? w0_um * Math.sqrt(1 + (z / rayleighRange_um) * (z / rayleighRange_um))
      : Number.NaN;

    out[base + ISO_COL.Z] = z;
    out[base + ISO_COL.POS_W] = wz;
    out[base + ISO_COL.NEG_W] = negNoZero(wz);
    out[base + ISO_COL.N_SPACER] = Number.NaN;

    for (let fIdx = 0; fIdx < ISOFLUENCE_FRACTIONS.length; fIdx++) {
      const f = ISOFLUENCE_FRACTIONS[fIdx];
      let r = Number.NaN;
      if (validBeam && peakFluence_J_cm2 > 0) {
        const wRatio = w0_um / wz;
        const arg = Math.log((wRatio * wRatio) / f);
        if (arg >= 0) {
          r = Math.sqrt(((wz * wz) / 2) * arg);
        }
      }
      out[base + ISO_COL.POS_0135 + fIdx] = r;
      out[base + ISO_COL.NEG_0135 + fIdx] = negNoZero(r);
    }

    const rAbl = validBeam
      ? computeIsofluenceRadiusForIntensity(
          w0_um,
          wz,
          peakFluence_J_cm2,
          ablationThreshold_J_cm2,
        )
      : Number.NaN;
    out[base + ISO_COL.POS_ABL] = rAbl;
    out[base + ISO_COL.NEG_ABL] = negNoZero(rAbl);

    const rTherm = validBeam
      ? computeIsofluenceRadiusForIntensity(
          w0_um,
          wz,
          peakFluence_J_cm2,
          thermThresh,
        )
      : Number.NaN;
    out[base + ISO_COL.POS_THERM] = rTherm;
    out[base + ISO_COL.NEG_THERM] = negNoZero(rTherm);
  }

  return out;
}
