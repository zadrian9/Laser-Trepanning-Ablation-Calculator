/**
 * Diffraction-limited Gaussian beam optics, energy, fluence, irradiance,
 * beam divergence, threshold radius, and Z-from-focus lookup (`Main!W7:W22`, `Calculations!L1`).
 */

import {
  ISO_COL,
  ISO_POINTS,
  ISO_STRIDE,
  type DivergenceMode,
  type HoleType,
  type ResolvedPhysicsInput,
} from '../types/physics.ts';

export const EXP_NEG_50 = Math.exp(-50); // 1.9287498479639178e-22

export interface OpticsResult {
  outputRepRate_kHz: number;
  pulseEnergyBase_uJ: number;
  pulseEnergyOutput_uJ: number;
  avgPower_W: number;
  peakPower_MW: number;
  spotSize_um: number;
  w0_um: number;
  rayleighRange_um: number;
  peakFluence_J_cm2: number;
  peakIrradiance_TW_cm2: number;
  avgIrradiance_MW_cm2: number;
  scanSpeed_mm_s: number;
  spotOverlap_pct: number;
  ablatedSpotAt0_um: number;
  thresholdR: number;
  thresholdRatio: number;
  energyAboveThresh_pct: number;
  beamDivergence_mrad: number;
}

export function calculateOptics(
  resolved: Pick<
    ResolvedPhysicsInput,
    | 'basePower_W'
    | 'baseRepRate_kHz'
    | 'divider'
    | 'attenuator_pct'
    | 'transmission_pct'
    | 'pulseWidth_fs'
    | 'focalLength_mm'
    | 'beamDiameter_mm'
    | 'mSquared'
    | 'wavelength_um'
    | 'ablationThreshold_J_cm2'
    | 'scanSpeed_Hz'
    | 'holeType'
    | 'divergenceMode'
  >,
  effectiveScanRadius_um: number,
  totalXYScaling: number,
): OpticsResult {
  const {
    basePower_W,
    baseRepRate_kHz,
    divider,
    attenuator_pct,
    transmission_pct,
    pulseWidth_fs,
    focalLength_mm,
    beamDiameter_mm,
    mSquared,
    wavelength_um,
    ablationThreshold_J_cm2,
    scanSpeed_Hz,
    holeType,
    divergenceMode,
  } = resolved;

  const outputRepRate_kHz = divider > 0 ? baseRepRate_kHz / divider : 0;
  const pulseEnergyBase_uJ =
    baseRepRate_kHz > 0 ? (basePower_W / baseRepRate_kHz) * 1000 : 0;
  const pulseEnergyOutput_uJ =
    pulseEnergyBase_uJ * (attenuator_pct / 100) * (transmission_pct / 100);
  const avgPower_W =
    divider > 0
      ? (basePower_W / divider) * (attenuator_pct / 100) * (transmission_pct / 100)
      : 0;

  const peakPower_MW =
    pulseWidth_fs > 0
      ? ((2 * pulseEnergyOutput_uJ * 1e-6) / (pulseWidth_fs * 1e-15)) *
        Math.sqrt(Math.LN2 / Math.PI) /
        1e6
      : 0;

  const spotSize_um =
    beamDiameter_mm > 0
      ? ((4 * wavelength_um * mSquared) / Math.PI) *
        (focalLength_mm / beamDiameter_mm)
      : 0;
  const w0_um = spotSize_um / 2;

  const rayleighRange_um =
    wavelength_um > 0 && mSquared > 0
      ? (Math.PI * Math.pow(w0_um / mSquared, 2)) / wavelength_um
      : 0;

  const w0_cm = w0_um * 1e-4;
  const peakFluence_J_cm2 =
    w0_cm > 0
      ? (2 * pulseEnergyOutput_uJ * 1e-6) / (Math.PI * w0_cm * w0_cm)
      : 0;

  const peakIrradiance_TW_cm2 =
    pulseWidth_fs > 0 && w0_cm > 0
      ? ((4 * pulseEnergyOutput_uJ * 1e-6) /
          (pulseWidth_fs * 1e-15 * Math.PI * w0_cm * w0_cm)) *
        Math.sqrt(Math.LN2 / Math.PI) /
        1e12
      : 0;

  const avgIrradiance_MW_cm2 =
    (peakFluence_J_cm2 * outputRepRate_kHz * 1000) / 1e6;

  // Linear scan speed (mm/s) with XY scaling applied to both Round and Square holes
  const scanSpeed_mm_s = computeScanSpeed(
    holeType,
    effectiveScanRadius_um,
    scanSpeed_Hz,
    totalXYScaling,
  );

  // Spot overlap (%)
  const repRate_Hz = outputRepRate_kHz * 1000;
  const spotOverlap_pct =
    repRate_Hz > 0 && spotSize_um > 0
      ? (1 - ((scanSpeed_mm_s / repRate_Hz) * 1000) / spotSize_um) * 100
      : 0;

  // Ablated spot diameter at focus (z = 0)
  let ablatedSpotAt0_um = 0;
  if (peakFluence_J_cm2 > ablationThreshold_J_cm2 && ablationThreshold_J_cm2 > 0) {
    ablatedSpotAt0_um =
      2 *
      Math.sqrt(
        ((w0_um * w0_um) / 2) *
          Math.log(peakFluence_J_cm2 / ablationThreshold_J_cm2),
      );
  }

  // Threshold normalized radius r_th / w0 (Calculations!L1)
  const thresholdRatio =
    peakFluence_J_cm2 > 0
      ? ablationThreshold_J_cm2 / peakFluence_J_cm2
      : Number.NaN;
  let thresholdR = 0;
  if (peakFluence_J_cm2 > 0) {
    if (thresholdRatio < EXP_NEG_50) {
      thresholdR = 5;
    } else {
      const negHalfLn = -0.5 * Math.log(thresholdRatio);
      thresholdR = negHalfLn < 0 ? 0 : Math.sqrt(negHalfLn);
    }
  }

  const energyAboveThresh_pct =
    thresholdR === 0 ? 0 : 100 * (1 - Math.exp(-2 * thresholdR * thresholdR));

  const beamDivergence_mrad = computeBeamDivergence(
    wavelength_um,
    w0_um,
    divergenceMode,
  );

  return {
    outputRepRate_kHz,
    pulseEnergyBase_uJ,
    pulseEnergyOutput_uJ,
    avgPower_W,
    peakPower_MW,
    spotSize_um,
    w0_um,
    rayleighRange_um,
    peakFluence_J_cm2,
    peakIrradiance_TW_cm2,
    avgIrradiance_MW_cm2,
    scanSpeed_mm_s,
    spotOverlap_pct,
    ablatedSpotAt0_um,
    thresholdR,
    thresholdRatio,
    energyAboveThresh_pct,
    beamDivergence_mrad,
  };
}

export function computeScanSpeed(
  holeType: HoleType,
  effectiveScanRadius_um: number,
  scanSpeed_Hz: number,
  totalXYScaling: number,
): number {
  if (holeType === 'round') {
    return (effectiveScanRadius_um * scanSpeed_Hz * 2 * Math.PI) / 1000;
  }
  return scanSpeed_Hz * totalXYScaling;
}

export function computeBeamDivergence(
  wavelength_um: number,
  w0_um: number,
  divergenceMode: DivergenceMode,
): number {
  if (w0_um <= 0) return 0;
  const scale = divergenceMode === 'legacy' ? 100 : 1000;
  return (wavelength_um / (w0_um * Math.PI)) * scale;
}

/**
 * Exact Excel VLOOKUP(W21, IsofluenceCalcs!C2:L1002, 10, TRUE) * 2
 * Returns NaN if zLookup_um < 0 or if r_abl at the matched row is NaN.
 */
export function lookupAblatedSpotFromIsofluence(
  zLookup_um: number,
  isofluence: Float64Array,
): number {
  if (!Number.isFinite(zLookup_um) || zLookup_um < 0) {
    return Number.NaN;
  }
  let lo = 0;
  let hi = ISO_POINTS - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1;
    if (isofluence[mid * ISO_STRIDE + ISO_COL.Z] <= zLookup_um) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  const rAbl = isofluence[lo * ISO_STRIDE + ISO_COL.POS_ABL];
  return Number.isNaN(rAbl) ? Number.NaN : 2 * rAbl;
}

/**
 * Continuous analytical evaluation of ablated spot diameter 2 * r_abl(z) at distance z >= 0 from focus.
 * Returns NaN if z < 0 or I(z) < ablationThreshold.
 */
export function calculateAblatedSpotAtZ(
  zFromFocus_um: number,
  w0_um: number,
  rayleighRange_um: number,
  peakFluence_J_cm2: number,
  ablationThreshold_J_cm2: number,
): number {
  if (
    !Number.isFinite(zFromFocus_um) ||
    zFromFocus_um < 0 ||
    w0_um <= 0 ||
    rayleighRange_um <= 0 ||
    peakFluence_J_cm2 <= 0 ||
    ablationThreshold_J_cm2 <= 0
  ) {
    return Number.NaN;
  }
  const ratioZ = zFromFocus_um / rayleighRange_um;
  const wz = w0_um * Math.sqrt(1 + ratioZ * ratioZ);
  const wRatio = w0_um / wz;
  const iz = peakFluence_J_cm2 * wRatio * wRatio;
  if (iz < ablationThreshold_J_cm2) {
    return Number.NaN;
  }
  return 2 * Math.sqrt(((wz * wz) / 2) * Math.log(iz / ablationThreshold_J_cm2));
}
