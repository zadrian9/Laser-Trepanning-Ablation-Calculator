/**
 * 601-point Focus Energy Distribution (`Calculations!E202:J802`) over r/w0 in [-3.00, +3.00].
 */

import {
  DIST_COL,
  DIST_LEN,
  DIST_POINTS,
  DIST_STRIDE,
} from '../types/physics.ts';

export function computeFocusDistribution(
  w0_um: number,
  peakFluence_J_cm2: number,
  ablationThreshold_J_cm2: number,
  out: Float64Array = new Float64Array(DIST_LEN),
): Float64Array {
  const thresholdRatio =
    peakFluence_J_cm2 > 0
      ? ablationThreshold_J_cm2 / peakFluence_J_cm2
      : Number.NaN;

  for (let i = 0; i < DIST_POINTS; i++) {
    const base = i * DIST_STRIDE;
    const rNorm = (-300 + i) / 100;
    const rUm = rNorm * w0_um;
    const gaussian = Math.exp(-2 * rNorm * rNorm);
    const noAblation =
      peakFluence_J_cm2 > 0 && gaussian > thresholdRatio ? 0 : gaussian;
    const ablation = gaussian - noAblation;

    out[base + DIST_COL.R_UM] = rUm;
    out[base + DIST_COL.R_NORM] = rNorm;
    out[base + DIST_COL.GAUSSIAN] = gaussian;
    out[base + DIST_COL.NO_ABLATION] = noAblation;
    out[base + DIST_COL.ABLATION] = ablation;
  }

  return out;
}
