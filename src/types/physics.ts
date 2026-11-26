/**
 * Canonical physics types, interface contracts, and deterministic Float64Array
 * Transferable buffer codec shared between AssemblyScript WASM, TS fallback,
 * Web Worker, and UI/Canvas layers.
 */

export type HoleType = 'round' | 'square';
export type ColorType = 'IR' | 'Green';
export type ScanheadBrand = 'Arges' | 'Scanlab';
export type Direction = 'CCW' | 'CW';
export type DivergenceMode = 'current' | 'legacy';
export type StateMode = 'single' | 'transition';

export type LaserId =
  | 'CHARMILLES_IR'
  | 'CHARMILLES_GR'
  | 'CARBIDE_IR'
  | 'CARBIDE_GR'
  | 'MONACO'
  | 'MANUAL';

export type ScanheadId = 'PE2IR' | 'SLIR' | 'SLGR' | 'MANUAL';

export type ExcelLaserCode = 'FFPIR' | 'FFPGR' | 'MONACO' | 'MANUAL';
export type ScanheadExcelCode = 'PE2IR' | 'SLIR' | 'SLGR' | 'MANUAL';

export interface LaserPreset {
  readonly id: LaserId;
  readonly excelCode: ExcelLaserCode;
  readonly name: string;
  readonly pulseWidth_fs: number;
  readonly wavelength_um: number;
  readonly color: ColorType;
  readonly defaultPower_W: number;
  readonly defaultRepRate_kHz: number;
  readonly defaultAttenuator_pct: number;
  readonly defaultDivider: number;
  readonly isManual: boolean;
}

export interface ScanheadPreset {
  readonly id: ScanheadId;
  readonly excelCode: ScanheadExcelCode;
  readonly name: string;
  readonly brand: ScanheadBrand;
  readonly color: ColorType;
  readonly focalLength_mm: number;
  readonly beamDiameter_mm: number;
  readonly transmission_pct: number;
  readonly scanSpeed_Hz: number;
  readonly mSquared: number;
  readonly maxAttackAngle_deg: number;
  readonly maxZTranslation_um: number;
  readonly defaultNozzleWD_mm: number;
  readonly defaultNozzleAperture_mm: number;
  readonly isManual: boolean;
}

export interface HoleTypeOption {
  readonly id: HoleType;
  readonly excelCode: 'RD' | 'SQ';
  readonly name: string;
}

export interface GraphLimits {
  zMin_um: number;
  zMax_um: number;
  rMin_um: number;
  rMax_um: number;
}

export interface CalculatorInput {
  // Equipment
  laserId: LaserId;
  scanheadId: ScanheadId;
  holeType: HoleType;

  // Manual overrides when MANUAL preset is selected
  manualLaserWavelength_um: number;
  manualLaserColor: ColorType;
  manualLaserPulseWidth_fs: number;
  manualScanheadBrand: ScanheadBrand;
  manualScanheadColor: ColorType;
  manualScanheadFocalLength_mm: number;
  manualScanheadBeamDia_mm: number;
  manualScanheadTransmission_pct: number;
  manualScanheadScanSpeed_Hz: number;
  manualScanheadM2: number;
  manualScanheadMaxAttack_deg: number;
  manualScanheadMaxZTravel_um: number;

  // Process
  basePower_W: number;
  baseRepRate_kHz: number;
  divider: number;
  attenuator_pct: number;
  scanSpeed_Hz: number;

  // Geometry & Kinematics
  entranceDia_um: number;
  exitDia_um: number;
  materialThick_um: number;
  partSurface_Z_um: number;
  stateMode: StateMode;
  transitionProgress_pct: number; // 0..100
  startDia_um: number;
  startAOI: number;
  startZ: number;
  endDia_um: number;
  endAOI: number;
  endZ: number;
  jobScaling: number;
  nodeScaling: number;
  direction: Direction;
  phase1_deg: number;
  rotation1_deg: number;
  phase2_deg: number;
  rotation2_deg: number;
  distXYRotation_deg: number;

  // Nozzle & Optics Overrides (null = inherit preset/default)
  m2Override: number | null;
  pulseWidthOverride_fs: number | null;
  focalLengthOverride_mm: number | null;
  beamDiaOverride_mm: number | null;
  transmissionOverride_pct: number | null;
  focusRelZ_um: number | null;
  nozzleApertureDia_mm: number | null;
  nozzleWD_mm: number | null;
  nozzleThick_mm: number | null;
  maxAttackOverride_deg: number | null;
  ablationThreshOverride_J_cm2: number | null;

  // Toggles, Lookup & Plot Limits
  divergenceMode: DivergenceMode;
  zFromFocusLookup_um: number;
  showCounterBeam: boolean;
  graphLimits: GraphLimits;
}

export interface ResolvedPhysicsInput {
  holeType: HoleType;
  scanheadBrand: ScanheadBrand;
  direction: Direction;
  divergenceMode: DivergenceMode;
  stateMode: StateMode;
  transitionProgress_pct: number;
  laserColor: ColorType;
  scanheadColor: ColorType;

  basePower_W: number;
  baseRepRate_kHz: number;
  divider: number;
  attenuator_pct: number;
  scanSpeed_Hz: number;

  wavelength_um: number;
  pulseWidth_fs: number;
  focalLength_mm: number;
  beamDiameter_mm: number;
  mSquared: number;
  transmission_pct: number;
  maxAttack_deg: number;
  maxZTravel_um: number;
  ablationThreshold_J_cm2: number;
  focusRelZ_um: number;
  nozzleApertureDia_mm: number;
  nozzleWD_mm: number;
  nozzleThick_mm: number;

  entranceDia_um: number;
  exitDia_um: number;
  materialThick_um: number;
  partSurface_Z_um: number;

  startDia_um: number;
  startAOI: number;
  startZ: number;
  endDia_um: number;
  endAOI: number;
  endZ: number;

  jobScaling: number;
  nodeScaling: number;
  phase1_deg: number;
  rotation1_deg: number;
  phase2_deg: number;
  rotation2_deg: number;
  distXYRotation_deg: number;
  zFromFocusLookup_um: number;
}

export interface PhysicsScalars {
  // 18+ Golden & Core Optics Metrics
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
  energyAboveThresh_pct: number;
  beamDivergence_mrad: number;
  ablatedSpotAtLookupZ_um: number;

  // Active State & Kinematics
  activeScanDia_um: number;
  activeAOI: number;
  activeZ: number;
  effectiveScanRadius_um: number;
  zShift_um: number;
  attackPct: number;
  attackAngle_rad: number;
  rFocus_um: number;
  exitAperture1MaxR_um: number;
  exitAperture2MaxR_um: number;
  nozzleApertureRadius_um: number;
  nozzleClipping: boolean;
  wallOvercut: boolean;
  maxOvercut_um: number;
  chartScaleMax_um: number;
  zMaxIsofluence_um: number;
  wavelengthMismatch: boolean;
  argesSquareWarning: boolean;
  partSurface_um: number;
  materialThick_um: number;
  holeEntranceRadius_um: number;
  holeExitRadius_um: number;

  // Resolved Equipment / Process Parameters
  outputRepRate_kHz: number;
  wavelength_um: number;
  pulseWidth_fs: number;
  mSquared: number;
  focalLength_mm: number;
  beamDiameter_mm: number;
  transmission_pct: number;
  ablationThreshold_J_cm2: number;
  focusRelZ_um: number;
  nozzleWD_mm: number;
  nozzleThick_mm: number;
  nozzleApertureDia_mm: number;
  maxAttack_deg: number;
  zMaxTravel_um: number;
  thresholdRatio: number; // F_th / F_0
  nozzlePlane1Z_um: number;
  nozzlePlane2Z_um: number;
  aoiSquareScaling: number;
  totalXYScaling: number;
}

export interface TrepanningPathBuffers {
  theta: Float64Array; // 2003
  planeZ: Float64Array; // 8 (Exit1, Exit2, Focus, Top, Top25, Top50, Top75, Bottom)
  planeW: Float64Array; // 8
  planeRAbl: Float64Array; // 8 (NaN if no ablation at plane)
  planeCenterXY: Float64Array; // 8 * 2003 * 2
  plane1e2XY: Float64Array; // 8 * 2001 * 2 (steps 1..2001)
  planeAblXY: Float64Array; // 6 * 2001 * 2 (planes 2..7, steps 1..2001)
  holeEntranceXY: Float64Array; // 2003 * 2
  holeExitXY: Float64Array; // 2003 * 2
}

export interface PhysicsOutput {
  scalars: PhysicsScalars;
  focusDist: Float64Array; // 601 * 5
  isofluence: Float64Array; // 1001 * 22
  trepanningProfile: Float64Array; // 1001 * 16
  trepanningPath: TrepanningPathBuffers;
  transitionSweep: Float64Array; // 101 * 3
}

export type ComputeBackend = 'wasm' | 'ts';

export interface WorkerComputeRequest {
  id: number;
  input: CalculatorInput;
}

export interface WorkerComputeResponse {
  id: number;
  backend: ComputeBackend;
  computeMs: number;
  buffer: Float64Array;
  error?: string;
}

// ============================================================================
// Unified Buffer Constants & Layout Codec
// ============================================================================

export const INPUT_LEN = 44;
export const SCALARS_LEN = 64;

export const DIST_POINTS = 601;
export const DIST_STRIDE = 5;

export const ISO_POINTS = 1001;
export const ISO_STRIDE = 22;

export const PROFILE_POINTS = 1001;
export const PROFILE_STRIDE = 16;

export const PATH_STEPS = 2003;
export const CONTOUR_STEPS = 2001;
export const PLANE_COUNT = 8;
export const ABL_PLANE_COUNT = 6;

export const SWEEP_STATES = 101;
export const SWEEP_STRIDE = 3;

export const DIST_LEN = DIST_POINTS * DIST_STRIDE; // 3,005
export const ISO_LEN = ISO_POINTS * ISO_STRIDE; // 22,022
export const PROFILE_LEN = PROFILE_POINTS * PROFILE_STRIDE; // 16,016
export const PLANE_CENTER_LEN = PLANE_COUNT * PATH_STEPS * 2; // 32,048
export const PLANE_1E2_LEN = PLANE_COUNT * CONTOUR_STEPS * 2; // 32,016
export const PLANE_ABL_LEN = ABL_PLANE_COUNT * CONTOUR_STEPS * 2; // 24,012
export const HOLE_CIRCLE_LEN = PATH_STEPS * 2; // 4,006
export const SWEEP_LEN = SWEEP_STATES * SWEEP_STRIDE; // 303

export const OFFSETS = {
  SCALARS: 0,
  FOCUS_DIST: 64,
  ISOFLUENCE: 3_069,
  TREPANNING_PROFILE: 25_091,
  PATH_THETA: 41_107,
  PATH_PLANE_Z: 43_110,
  PATH_PLANE_W: 43_118,
  PATH_PLANE_R_ABL: 43_126,
  PATH_PLANE_CENTER_XY: 43_134,
  PATH_PLANE_1E2_XY: 75_182,
  PATH_PLANE_ABL_XY: 107_198,
  PATH_HOLE_ENTRANCE_XY: 131_210,
  PATH_HOLE_EXIT_XY: 135_216,
  TRANSITION_SWEEP: 139_222,
} as const;

export const OUTPUT_FLOAT_COUNT = 139_525;

export const DIST_COL = {
  R_UM: 0,
  R_NORM: 1,
  GAUSSIAN: 2,
  NO_ABLATION: 3,
  ABLATION: 4,
} as const;

export const ISO_COL = {
  Z: 0, // C
  POS_W: 1, // D
  POS_0135: 2, // E
  POS_020: 3, // F
  POS_030: 4, // G
  POS_040: 5, // H
  POS_050: 6, // I
  POS_070: 7, // J
  POS_090: 8, // K
  POS_ABL: 9, // L
  POS_THERM: 10, // M (I/64)
  N_SPACER: 11, // N (NaN spacer)
  NEG_W: 12, // O
  NEG_0135: 13, // P
  NEG_020: 14, // Q
  NEG_030: 15, // R
  NEG_040: 16, // S
  NEG_050: 17, // T
  NEG_070: 18, // U
  NEG_090: 19, // V
  NEG_ABL: 20, // W
  NEG_THERM: 21, // X (-I/64)
} as const;

export const PROFILE_CURVE = {
  FWD_TOP_RIGHT_ABL: 0, // B, C (+r_abl, alpha)
  FWD_BOT_RIGHT_ABL: 1, // E, F (-r_abl, alpha)
  BWD_BOT_LEFT_ABL: 2, // H, I (+r_abl, alpha + PI)
  BWD_TOP_LEFT_ABL: 3, // K, L (-r_abl, alpha + PI)
  FWD_TOP_RIGHT_W: 4, // N, O (+w_z, alpha)
  FWD_BOT_RIGHT_W: 5, // Q, R (-w_z, alpha)
  BWD_BOT_LEFT_W: 6, // T, U (+w_z, alpha + PI)
  BWD_TOP_LEFT_W: 7, // W, X (-w_z, alpha + PI)
} as const;

export const PLANE_INDEX = {
  EXIT_APERTURE_1: 0,
  EXIT_APERTURE_2: 1,
  FOCUS: 2,
  TOP: 3,
  TOP_25: 4,
  TOP_50: 5,
  TOP_75: 6,
  BOTTOM: 7,
} as const;

export const SCALAR_IDX = {
  PULSE_ENERGY_BASE: 0,
  PULSE_ENERGY_OUTPUT: 1,
  AVG_POWER: 2,
  PEAK_POWER: 3,
  SPOT_SIZE: 4,
  W0: 5,
  RAYLEIGH_RANGE: 6,
  PEAK_FLUENCE: 7,
  PEAK_IRRADIANCE: 8,
  AVG_IRRADIANCE: 9,
  SCAN_SPEED: 10,
  SPOT_OVERLAP: 11,
  ABLATED_SPOT_AT_0: 12,
  THRESHOLD_R: 13,
  ENERGY_ABOVE_THRESH: 14,
  BEAM_DIVERGENCE: 15,
  ABLATED_SPOT_AT_LOOKUP_Z: 16,
  ACTIVE_SCAN_DIA: 17,
  ACTIVE_AOI: 18,
  ACTIVE_Z: 19,
  EFFECTIVE_SCAN_RADIUS: 20,
  Z_SHIFT: 21,
  ATTACK_PCT: 22,
  ATTACK_ANGLE_RAD: 23,
  R_FOCUS: 24,
  EXIT_APERTURE_1_MAX_R: 25,
  EXIT_APERTURE_2_MAX_R: 26,
  NOZZLE_APERTURE_RADIUS: 27,
  NOZZLE_CLIPPING: 28,
  WALL_OVERCUT: 29,
  MAX_OVERCUT: 30,
  CHART_SCALE_MAX: 31,
  Z_MAX_ISOFLUENCE: 32,
  WAVELENGTH_MISMATCH: 33,
  ARGES_SQUARE_WARNING: 34,
  PART_SURFACE: 35,
  MATERIAL_THICK: 36,
  HOLE_ENTRANCE_RADIUS: 37,
  HOLE_EXIT_RADIUS: 38,
  THRESHOLD_RATIO: 39,
  OUTPUT_REP_RATE: 40,
  WAVELENGTH: 41,
  PULSE_WIDTH: 42,
  M_SQUARED: 43,
  FOCAL_LENGTH: 44,
  BEAM_DIAMETER: 45,
  TRANSMISSION: 46,
  ABLATION_THRESHOLD: 47,
  FOCUS_REL_Z: 48,
  NOZZLE_WD: 49,
  NOZZLE_THICK: 50,
  NOZZLE_APERTURE_DIA: 51,
  MAX_ATTACK: 52,
  Z_MAX_TRAVEL: 53,
  NOZZLE_PLANE_1_Z: 54,
  NOZZLE_PLANE_2_Z: 55,
  AOI_SQUARE_SCALING: 56,
  TOTAL_XY_SCALING: 57,
} as const;

export function packResolvedInput(
  resolved: ResolvedPhysicsInput,
  out: Float64Array = new Float64Array(INPUT_LEN),
): Float64Array {
  if (out.length < INPUT_LEN) {
    throw new RangeError(`Expected input buffer length >= ${INPUT_LEN}, got ${out.length}`);
  }
  out[0] = resolved.holeType === 'square' ? 1 : 0;
  out[1] = resolved.scanheadBrand === 'Arges' ? 1 : 0;
  out[2] = resolved.direction === 'CW' ? 1 : 0;
  out[3] = resolved.divergenceMode === 'legacy' ? 1 : 0;
  out[4] = resolved.stateMode === 'transition' ? 1 : 0;
  out[5] = resolved.transitionProgress_pct;
  out[6] = resolved.laserColor === 'Green' ? 1 : 0;
  out[7] = resolved.scanheadColor === 'Green' ? 1 : 0;
  out[8] = resolved.basePower_W;
  out[9] = resolved.baseRepRate_kHz;
  out[10] = resolved.divider;
  out[11] = resolved.attenuator_pct;
  out[12] = resolved.scanSpeed_Hz;
  out[13] = resolved.wavelength_um;
  out[14] = resolved.pulseWidth_fs;
  out[15] = resolved.focalLength_mm;
  out[16] = resolved.beamDiameter_mm;
  out[17] = resolved.mSquared;
  out[18] = resolved.transmission_pct;
  out[19] = resolved.maxAttack_deg;
  out[20] = resolved.maxZTravel_um;
  out[21] = resolved.ablationThreshold_J_cm2;
  out[22] = resolved.focusRelZ_um;
  out[23] = resolved.nozzleApertureDia_mm;
  out[24] = resolved.nozzleWD_mm;
  out[25] = resolved.nozzleThick_mm;
  out[26] = resolved.entranceDia_um;
  out[27] = resolved.exitDia_um;
  out[28] = resolved.materialThick_um;
  out[29] = resolved.partSurface_Z_um;
  out[30] = resolved.startDia_um;
  out[31] = resolved.startAOI;
  out[32] = resolved.startZ;
  out[33] = resolved.endDia_um;
  out[34] = resolved.endAOI;
  out[35] = resolved.endZ;
  out[36] = resolved.jobScaling;
  out[37] = resolved.nodeScaling;
  out[38] = resolved.phase1_deg;
  out[39] = resolved.rotation1_deg;
  out[40] = resolved.phase2_deg;
  out[41] = resolved.rotation2_deg;
  out[42] = resolved.distXYRotation_deg;
  out[43] = resolved.zFromFocusLookup_um;
  return out;
}

export function unpackPhysicsOutput(buffer: Float64Array): PhysicsOutput {
  if (buffer.length < OUTPUT_FLOAT_COUNT) {
    throw new RangeError(
      `Expected output buffer length >= ${OUTPUT_FLOAT_COUNT}, got ${buffer.length}`,
    );
  }

  const scalars: PhysicsScalars = {
    pulseEnergyBase_uJ: buffer[SCALAR_IDX.PULSE_ENERGY_BASE],
    pulseEnergyOutput_uJ: buffer[SCALAR_IDX.PULSE_ENERGY_OUTPUT],
    avgPower_W: buffer[SCALAR_IDX.AVG_POWER],
    peakPower_MW: buffer[SCALAR_IDX.PEAK_POWER],
    spotSize_um: buffer[SCALAR_IDX.SPOT_SIZE],
    w0_um: buffer[SCALAR_IDX.W0],
    rayleighRange_um: buffer[SCALAR_IDX.RAYLEIGH_RANGE],
    peakFluence_J_cm2: buffer[SCALAR_IDX.PEAK_FLUENCE],
    peakIrradiance_TW_cm2: buffer[SCALAR_IDX.PEAK_IRRADIANCE],
    avgIrradiance_MW_cm2: buffer[SCALAR_IDX.AVG_IRRADIANCE],
    scanSpeed_mm_s: buffer[SCALAR_IDX.SCAN_SPEED],
    spotOverlap_pct: buffer[SCALAR_IDX.SPOT_OVERLAP],
    ablatedSpotAt0_um: buffer[SCALAR_IDX.ABLATED_SPOT_AT_0],
    thresholdR: buffer[SCALAR_IDX.THRESHOLD_R],
    energyAboveThresh_pct: buffer[SCALAR_IDX.ENERGY_ABOVE_THRESH],
    beamDivergence_mrad: buffer[SCALAR_IDX.BEAM_DIVERGENCE],
    ablatedSpotAtLookupZ_um: buffer[SCALAR_IDX.ABLATED_SPOT_AT_LOOKUP_Z],
    activeScanDia_um: buffer[SCALAR_IDX.ACTIVE_SCAN_DIA],
    activeAOI: buffer[SCALAR_IDX.ACTIVE_AOI],
    activeZ: buffer[SCALAR_IDX.ACTIVE_Z],
    effectiveScanRadius_um: buffer[SCALAR_IDX.EFFECTIVE_SCAN_RADIUS],
    zShift_um: buffer[SCALAR_IDX.Z_SHIFT],
    attackPct: buffer[SCALAR_IDX.ATTACK_PCT],
    attackAngle_rad: buffer[SCALAR_IDX.ATTACK_ANGLE_RAD],
    rFocus_um: buffer[SCALAR_IDX.R_FOCUS],
    exitAperture1MaxR_um: buffer[SCALAR_IDX.EXIT_APERTURE_1_MAX_R],
    exitAperture2MaxR_um: buffer[SCALAR_IDX.EXIT_APERTURE_2_MAX_R],
    nozzleApertureRadius_um: buffer[SCALAR_IDX.NOZZLE_APERTURE_RADIUS],
    nozzleClipping: buffer[SCALAR_IDX.NOZZLE_CLIPPING] >= 0.5,
    wallOvercut: buffer[SCALAR_IDX.WALL_OVERCUT] >= 0.5,
    maxOvercut_um: buffer[SCALAR_IDX.MAX_OVERCUT],
    chartScaleMax_um: buffer[SCALAR_IDX.CHART_SCALE_MAX],
    zMaxIsofluence_um: buffer[SCALAR_IDX.Z_MAX_ISOFLUENCE],
    wavelengthMismatch: buffer[SCALAR_IDX.WAVELENGTH_MISMATCH] >= 0.5,
    argesSquareWarning: buffer[SCALAR_IDX.ARGES_SQUARE_WARNING] >= 0.5,
    partSurface_um: buffer[SCALAR_IDX.PART_SURFACE],
    materialThick_um: buffer[SCALAR_IDX.MATERIAL_THICK],
    holeEntranceRadius_um: buffer[SCALAR_IDX.HOLE_ENTRANCE_RADIUS],
    holeExitRadius_um: buffer[SCALAR_IDX.HOLE_EXIT_RADIUS],
    thresholdRatio: buffer[SCALAR_IDX.THRESHOLD_RATIO],
    outputRepRate_kHz: buffer[SCALAR_IDX.OUTPUT_REP_RATE],
    wavelength_um: buffer[SCALAR_IDX.WAVELENGTH],
    pulseWidth_fs: buffer[SCALAR_IDX.PULSE_WIDTH],
    mSquared: buffer[SCALAR_IDX.M_SQUARED],
    focalLength_mm: buffer[SCALAR_IDX.FOCAL_LENGTH],
    beamDiameter_mm: buffer[SCALAR_IDX.BEAM_DIAMETER],
    transmission_pct: buffer[SCALAR_IDX.TRANSMISSION],
    ablationThreshold_J_cm2: buffer[SCALAR_IDX.ABLATION_THRESHOLD],
    focusRelZ_um: buffer[SCALAR_IDX.FOCUS_REL_Z],
    nozzleWD_mm: buffer[SCALAR_IDX.NOZZLE_WD],
    nozzleThick_mm: buffer[SCALAR_IDX.NOZZLE_THICK],
    nozzleApertureDia_mm: buffer[SCALAR_IDX.NOZZLE_APERTURE_DIA],
    maxAttack_deg: buffer[SCALAR_IDX.MAX_ATTACK],
    zMaxTravel_um: buffer[SCALAR_IDX.Z_MAX_TRAVEL],
    nozzlePlane1Z_um: buffer[SCALAR_IDX.NOZZLE_PLANE_1_Z],
    nozzlePlane2Z_um: buffer[SCALAR_IDX.NOZZLE_PLANE_2_Z],
    aoiSquareScaling: buffer[SCALAR_IDX.AOI_SQUARE_SCALING],
    totalXYScaling: buffer[SCALAR_IDX.TOTAL_XY_SCALING],
  };

  return {
    scalars,
    focusDist: buffer.subarray(OFFSETS.FOCUS_DIST, OFFSETS.FOCUS_DIST + DIST_LEN),
    isofluence: buffer.subarray(OFFSETS.ISOFLUENCE, OFFSETS.ISOFLUENCE + ISO_LEN),
    trepanningProfile: buffer.subarray(
      OFFSETS.TREPANNING_PROFILE,
      OFFSETS.TREPANNING_PROFILE + PROFILE_LEN,
    ),
    trepanningPath: {
      theta: buffer.subarray(OFFSETS.PATH_THETA, OFFSETS.PATH_THETA + PATH_STEPS),
      planeZ: buffer.subarray(OFFSETS.PATH_PLANE_Z, OFFSETS.PATH_PLANE_Z + PLANE_COUNT),
      planeW: buffer.subarray(OFFSETS.PATH_PLANE_W, OFFSETS.PATH_PLANE_W + PLANE_COUNT),
      planeRAbl: buffer.subarray(OFFSETS.PATH_PLANE_R_ABL, OFFSETS.PATH_PLANE_R_ABL + PLANE_COUNT),
      planeCenterXY: buffer.subarray(
        OFFSETS.PATH_PLANE_CENTER_XY,
        OFFSETS.PATH_PLANE_CENTER_XY + PLANE_CENTER_LEN,
      ),
      plane1e2XY: buffer.subarray(
        OFFSETS.PATH_PLANE_1E2_XY,
        OFFSETS.PATH_PLANE_1E2_XY + PLANE_1E2_LEN,
      ),
      planeAblXY: buffer.subarray(
        OFFSETS.PATH_PLANE_ABL_XY,
        OFFSETS.PATH_PLANE_ABL_XY + PLANE_ABL_LEN,
      ),
      holeEntranceXY: buffer.subarray(
        OFFSETS.PATH_HOLE_ENTRANCE_XY,
        OFFSETS.PATH_HOLE_ENTRANCE_XY + HOLE_CIRCLE_LEN,
      ),
      holeExitXY: buffer.subarray(
        OFFSETS.PATH_HOLE_EXIT_XY,
        OFFSETS.PATH_HOLE_EXIT_XY + HOLE_CIRCLE_LEN,
      ),
    },
    transitionSweep: buffer.subarray(
      OFFSETS.TRANSITION_SWEEP,
      OFFSETS.TRANSITION_SWEEP + SWEEP_LEN,
    ),
  };
}
