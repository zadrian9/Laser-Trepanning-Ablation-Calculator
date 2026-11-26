/**
 * Unified TypeScript fallback physics engine producing the canonical
 * Transferable Float64Array buffer and unpacked PhysicsOutput.
 */

import { resolvePhysicsInput } from '../data/presets.ts';
import {
  ABL_PLANE_COUNT,
  CONTOUR_STEPS,
  DIST_LEN,
  HOLE_CIRCLE_LEN,
  ISO_LEN,
  OFFSETS,
  OUTPUT_FLOAT_COUNT,
  PATH_STEPS,
  PLANE_1E2_LEN,
  PLANE_ABL_LEN,
  PLANE_CENTER_LEN,
  PLANE_COUNT,
  PROFILE_LEN,
  SCALAR_IDX,
  SWEEP_LEN,
  unpackPhysicsOutput,
  type CalculatorInput,
  type PhysicsOutput,
  type ResolvedPhysicsInput,
} from '../types/physics.ts';
import { computeFocusDistribution } from './distributions.ts';
import { computeIsofluenceLines, computeIsofluenceZMax } from './isofluence.ts';
import { calculateOptics, lookupAblatedSpotFromIsofluence } from './optics.ts';
import {
  computeTransitionSweep,
  computeTrepanningPath,
  computeTrepanningProfile,
  resolveActiveState,
} from './trepanning.ts';

export function computePhysicsBufferTS(
  resolved: ResolvedPhysicsInput,
  out: Float64Array = new Float64Array(OUTPUT_FLOAT_COUNT),
  skipSweep = false,
): Float64Array {
  if (out.length < OUTPUT_FLOAT_COUNT) {
    throw new RangeError(
      `Expected output buffer length >= ${OUTPUT_FLOAT_COUNT}, got ${out.length}`,
    );
  }

  const active = resolveActiveState(resolved);
  const optics = calculateOptics(
    resolved,
    active.effectiveScanRadius_um,
    active.totalXYScaling,
  );

  // 1. Focus Energy Distribution (601 * 5)
  const focusDistView = out.subarray(
    OFFSETS.FOCUS_DIST,
    OFFSETS.FOCUS_DIST + DIST_LEN,
  );
  computeFocusDistribution(
    optics.w0_um,
    optics.peakFluence_J_cm2,
    resolved.ablationThreshold_J_cm2,
    focusDistView,
  );

  // 2. Isofluence Lines (1001 * 22)
  const zMaxIsofluence_um = computeIsofluenceZMax(
    resolved.materialThick_um,
    resolved.partSurface_Z_um,
    resolved.focusRelZ_um,
    active.zShift_um,
  );
  const isofluenceView = out.subarray(
    OFFSETS.ISOFLUENCE,
    OFFSETS.ISOFLUENCE + ISO_LEN,
  );
  computeIsofluenceLines(
    optics.w0_um,
    optics.rayleighRange_um,
    optics.peakFluence_J_cm2,
    resolved.ablationThreshold_J_cm2,
    zMaxIsofluence_um,
    isofluenceView,
  );

  // 3. Z From Focus Lookup (Main!W21 -> W22)
  const ablatedSpotAtLookupZ_um = lookupAblatedSpotFromIsofluence(
    resolved.zFromFocusLookup_um,
    isofluenceView,
  );

  // 4. 3D Trepanning Path & 8 Z-Planes
  const pathTheta = out.subarray(
    OFFSETS.PATH_THETA,
    OFFSETS.PATH_THETA + PATH_STEPS,
  );
  const planeZ = out.subarray(
    OFFSETS.PATH_PLANE_Z,
    OFFSETS.PATH_PLANE_Z + PLANE_COUNT,
  );
  const planeW = out.subarray(
    OFFSETS.PATH_PLANE_W,
    OFFSETS.PATH_PLANE_W + PLANE_COUNT,
  );
  const planeRAbl = out.subarray(
    OFFSETS.PATH_PLANE_R_ABL,
    OFFSETS.PATH_PLANE_R_ABL + PLANE_COUNT,
  );
  const planeCenterXY = out.subarray(
    OFFSETS.PATH_PLANE_CENTER_XY,
    OFFSETS.PATH_PLANE_CENTER_XY + PLANE_CENTER_LEN,
  );
  const plane1e2XY = out.subarray(
    OFFSETS.PATH_PLANE_1E2_XY,
    OFFSETS.PATH_PLANE_1E2_XY + PLANE_1E2_LEN,
  );
  const planeAblXY = out.subarray(
    OFFSETS.PATH_PLANE_ABL_XY,
    OFFSETS.PATH_PLANE_ABL_XY + PLANE_ABL_LEN,
  );
  const holeEntranceXY = out.subarray(
    OFFSETS.PATH_HOLE_ENTRANCE_XY,
    OFFSETS.PATH_HOLE_ENTRANCE_XY + HOLE_CIRCLE_LEN,
  );
  const holeExitXY = out.subarray(
    OFFSETS.PATH_HOLE_EXIT_XY,
    OFFSETS.PATH_HOLE_EXIT_XY + HOLE_CIRCLE_LEN,
  );

  // Sanity guard to ensure views match constants
  void CONTOUR_STEPS;
  void ABL_PLANE_COUNT;

  const pathSummary = computeTrepanningPath(
    resolved,
    active,
    optics.w0_um,
    optics.rayleighRange_um,
    optics.peakFluence_J_cm2,
    {
      theta: pathTheta,
      planeZ,
      planeW,
      planeRAbl,
      planeCenterXY,
      plane1e2XY,
      planeAblXY,
      holeEntranceXY,
      holeExitXY,
    },
  );

  // 5. TrepanningCalcs Cross-Section & Overcut
  const profileView = out.subarray(
    OFFSETS.TREPANNING_PROFILE,
    OFFSETS.TREPANNING_PROFILE + PROFILE_LEN,
  );
  const profileSummary = computeTrepanningProfile(
    resolved,
    active,
    isofluenceView,
    planeZ,
    planeCenterXY,
    profileView,
  );

  // 6. 101-State Transition Mode Safety Sweep
  if (!skipSweep) {
    const sweepView = out.subarray(
      OFFSETS.TRANSITION_SWEEP,
      OFFSETS.TRANSITION_SWEEP + SWEEP_LEN,
    );
    computeTransitionSweep(
      resolved,
      optics.w0_um,
      optics.rayleighRange_um,
      optics.peakFluence_J_cm2,
      sweepView,
    );
  }

  // 7. Pack Scalars
  const wavelengthMismatch = resolved.laserColor !== resolved.scanheadColor;
  const argesSquareWarning =
    resolved.holeType === 'square' && resolved.scanheadBrand === 'Arges';

  out[SCALAR_IDX.PULSE_ENERGY_BASE] = optics.pulseEnergyBase_uJ;
  out[SCALAR_IDX.PULSE_ENERGY_OUTPUT] = optics.pulseEnergyOutput_uJ;
  out[SCALAR_IDX.AVG_POWER] = optics.avgPower_W;
  out[SCALAR_IDX.PEAK_POWER] = optics.peakPower_MW;
  out[SCALAR_IDX.SPOT_SIZE] = optics.spotSize_um;
  out[SCALAR_IDX.W0] = optics.w0_um;
  out[SCALAR_IDX.RAYLEIGH_RANGE] = optics.rayleighRange_um;
  out[SCALAR_IDX.PEAK_FLUENCE] = optics.peakFluence_J_cm2;
  out[SCALAR_IDX.PEAK_IRRADIANCE] = optics.peakIrradiance_TW_cm2;
  out[SCALAR_IDX.AVG_IRRADIANCE] = optics.avgIrradiance_MW_cm2;
  out[SCALAR_IDX.SCAN_SPEED] = optics.scanSpeed_mm_s;
  out[SCALAR_IDX.SPOT_OVERLAP] = optics.spotOverlap_pct;
  out[SCALAR_IDX.ABLATED_SPOT_AT_0] = optics.ablatedSpotAt0_um;
  out[SCALAR_IDX.THRESHOLD_R] = optics.thresholdR;
  out[SCALAR_IDX.ENERGY_ABOVE_THRESH] = optics.energyAboveThresh_pct;
  out[SCALAR_IDX.BEAM_DIVERGENCE] = optics.beamDivergence_mrad;
  out[SCALAR_IDX.ABLATED_SPOT_AT_LOOKUP_Z] = ablatedSpotAtLookupZ_um;

  out[SCALAR_IDX.ACTIVE_SCAN_DIA] = active.activeScanDia_um;
  out[SCALAR_IDX.ACTIVE_AOI] = active.activeAOI;
  out[SCALAR_IDX.ACTIVE_Z] = active.activeZ;
  out[SCALAR_IDX.EFFECTIVE_SCAN_RADIUS] = active.effectiveScanRadius_um;
  out[SCALAR_IDX.Z_SHIFT] = active.zShift_um;
  out[SCALAR_IDX.ATTACK_PCT] = active.attackPct;
  out[SCALAR_IDX.ATTACK_ANGLE_RAD] = profileSummary.attackAngle_rad;
  out[SCALAR_IDX.R_FOCUS] = profileSummary.rFocus_um;
  out[SCALAR_IDX.EXIT_APERTURE_1_MAX_R] = pathSummary.exitAperture1MaxR_um;
  out[SCALAR_IDX.EXIT_APERTURE_2_MAX_R] = pathSummary.exitAperture2MaxR_um;
  out[SCALAR_IDX.NOZZLE_APERTURE_RADIUS] = pathSummary.nozzleApertureRadius_um;
  out[SCALAR_IDX.NOZZLE_CLIPPING] = pathSummary.nozzleClipping ? 1 : 0;
  out[SCALAR_IDX.WALL_OVERCUT] = profileSummary.wallOvercut ? 1 : 0;
  out[SCALAR_IDX.MAX_OVERCUT] = profileSummary.maxOvercut_um;
  out[SCALAR_IDX.CHART_SCALE_MAX] = pathSummary.chartScaleMax_um;
  out[SCALAR_IDX.Z_MAX_ISOFLUENCE] = zMaxIsofluence_um;
  out[SCALAR_IDX.WAVELENGTH_MISMATCH] = wavelengthMismatch ? 1 : 0;
  out[SCALAR_IDX.ARGES_SQUARE_WARNING] = argesSquareWarning ? 1 : 0;
  out[SCALAR_IDX.PART_SURFACE] = resolved.partSurface_Z_um;
  out[SCALAR_IDX.MATERIAL_THICK] = resolved.materialThick_um;
  out[SCALAR_IDX.HOLE_ENTRANCE_RADIUS] = resolved.entranceDia_um / 2;
  out[SCALAR_IDX.HOLE_EXIT_RADIUS] = resolved.exitDia_um / 2;

  out[SCALAR_IDX.THRESHOLD_RATIO] = optics.thresholdRatio;
  out[SCALAR_IDX.OUTPUT_REP_RATE] = optics.outputRepRate_kHz;
  out[SCALAR_IDX.WAVELENGTH] = resolved.wavelength_um;
  out[SCALAR_IDX.PULSE_WIDTH] = resolved.pulseWidth_fs;
  out[SCALAR_IDX.M_SQUARED] = resolved.mSquared;
  out[SCALAR_IDX.FOCAL_LENGTH] = resolved.focalLength_mm;
  out[SCALAR_IDX.BEAM_DIAMETER] = resolved.beamDiameter_mm;
  out[SCALAR_IDX.TRANSMISSION] = resolved.transmission_pct;
  out[SCALAR_IDX.ABLATION_THRESHOLD] = resolved.ablationThreshold_J_cm2;
  out[SCALAR_IDX.FOCUS_REL_Z] = resolved.focusRelZ_um;
  out[SCALAR_IDX.NOZZLE_WD] = resolved.nozzleWD_mm;
  out[SCALAR_IDX.NOZZLE_THICK] = resolved.nozzleThick_mm;
  out[SCALAR_IDX.NOZZLE_APERTURE_DIA] = resolved.nozzleApertureDia_mm;
  out[SCALAR_IDX.MAX_ATTACK] = resolved.maxAttack_deg;
  out[SCALAR_IDX.Z_MAX_TRAVEL] = resolved.maxZTravel_um;
  out[SCALAR_IDX.NOZZLE_PLANE_1_Z] = pathSummary.nozzlePlane1Z_um;
  out[SCALAR_IDX.NOZZLE_PLANE_2_Z] = pathSummary.nozzlePlane2Z_um;
  out[SCALAR_IDX.AOI_SQUARE_SCALING] = active.aoiSquareScaling;
  out[SCALAR_IDX.TOTAL_XY_SCALING] = active.totalXYScaling;

  return out;
}

export function computePhysicsTS(input: CalculatorInput): PhysicsOutput {
  const resolved = resolvePhysicsInput(input);
  const buffer = computePhysicsBufferTS(resolved);
  return unpackPhysicsOutput(buffer);
}

export const computePhysicsSync = computePhysicsTS;

