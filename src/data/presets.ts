/**
 * Equipment presets (`Data Inputs` sheet), defaults, and input parameter resolver.
 * Replaces "GF" with "Charmilles" while preserving all other names and Excel codes.
 */

import type {
  CalculatorInput,
  GraphLimits,
  HoleTypeOption,
  LaserId,
  LaserPreset,
  ResolvedPhysicsInput,
  ScanheadId,
  ScanheadPreset,
} from '../types/physics.ts';

export const DEFAULT_ABLATION_THRESHOLD_J_CM2 = 2.0;
export const DEFAULT_NOZZLE_WD_MM = 1.4;
export const DEFAULT_NOZZLE_APERTURE_MM = 1.0;
export const DEFAULT_NOZZLE_THICK_MM = 2.0;

export const DEFAULT_GRAPH_LIMITS: Readonly<GraphLimits> = {
  zMin_um: -500,
  zMax_um: 1500,
  rMin_um: -80,
  rMax_um: 120,
};

export const LASER_PRESETS: readonly LaserPreset[] = [
  {
    id: 'CHARMILLES_IR',
    excelCode: 'FFPIR',
    name: 'Charmilles Femto FlexiPulse IR',
    pulseWidth_fs: 250,
    wavelength_um: 1.035,
    color: 'IR',
    defaultPower_W: 40,
    defaultRepRate_kHz: 200,
    defaultAttenuator_pct: 100,
    defaultDivider: 4,
    isManual: false,
  },
  {
    id: 'CHARMILLES_GR',
    excelCode: 'FFPGR',
    name: 'Charmilles Femto FlexiPulse Green',
    pulseWidth_fs: 250,
    wavelength_um: 0.515,
    color: 'Green',
    defaultPower_W: 20,
    defaultRepRate_kHz: 200,
    defaultAttenuator_pct: 100,
    defaultDivider: 4,
    isManual: false,
  },
  {
    id: 'CARBIDE_IR',
    excelCode: 'FFPIR',
    name: 'Light Conversion Carbide IR',
    pulseWidth_fs: 250,
    wavelength_um: 1.035,
    color: 'IR',
    defaultPower_W: 40,
    defaultRepRate_kHz: 200,
    defaultAttenuator_pct: 100,
    defaultDivider: 4,
    isManual: false,
  },
  {
    id: 'CARBIDE_GR',
    excelCode: 'FFPGR',
    name: 'Light Conversion Carbide Green',
    pulseWidth_fs: 250,
    wavelength_um: 0.515,
    color: 'Green',
    defaultPower_W: 20,
    defaultRepRate_kHz: 200,
    defaultAttenuator_pct: 100,
    defaultDivider: 4,
    isManual: false,
  },
  {
    id: 'MONACO',
    excelCode: 'MONACO',
    name: 'Coherent Monaco',
    pulseWidth_fs: 270,
    wavelength_um: 1.035,
    color: 'IR',
    defaultPower_W: 60,
    defaultRepRate_kHz: 1000,
    defaultAttenuator_pct: 100,
    defaultDivider: 10,
    isManual: false,
  },
  {
    id: 'MANUAL',
    excelCode: 'MANUAL',
    name: 'Manual Input',
    pulseWidth_fs: 500,
    wavelength_um: 0.515,
    color: 'Green',
    defaultPower_W: 40,
    defaultRepRate_kHz: 200,
    defaultAttenuator_pct: 100,
    defaultDivider: 4,
    isManual: true,
  },
];

export const SCANHEAD_PRESETS: readonly ScanheadPreset[] = [
  {
    id: 'PE2IR',
    excelCode: 'PE2IR',
    name: 'Arges Elephant v2 IR',
    brand: 'Arges',
    color: 'IR',
    focalLength_mm: 60,
    beamDiameter_mm: 9,
    transmission_pct: 85,
    scanSpeed_Hz: 500,
    mSquared: 1.2,
    maxAttackAngle_deg: 10,
    maxZTranslation_um: 1050,
    defaultNozzleWD_mm: 1.4,
    defaultNozzleAperture_mm: 1.0,
    isManual: false,
  },
  {
    id: 'SLIR',
    excelCode: 'SLIR',
    name: 'Scanlab PrecSYS IR',
    brand: 'Scanlab',
    color: 'IR',
    focalLength_mm: 75,
    beamDiameter_mm: 7,
    transmission_pct: 90,
    scanSpeed_Hz: 500,
    mSquared: 1.1,
    maxAttackAngle_deg: 7.5,
    maxZTranslation_um: 1000,
    defaultNozzleWD_mm: 1.4,
    defaultNozzleAperture_mm: 1.0,
    isManual: false,
  },
  {
    id: 'SLGR',
    excelCode: 'SLGR',
    name: 'Scanlab PrecSYS Green',
    brand: 'Scanlab',
    color: 'Green',
    focalLength_mm: 75,
    beamDiameter_mm: 7,
    transmission_pct: 90,
    scanSpeed_Hz: 500,
    mSquared: 1.1,
    maxAttackAngle_deg: 7.5,
    maxZTranslation_um: 1000,
    defaultNozzleWD_mm: 1.4,
    defaultNozzleAperture_mm: 1.0,
    isManual: false,
  },
  {
    id: 'MANUAL',
    excelCode: 'MANUAL',
    name: 'Manual Input',
    brand: 'Scanlab',
    color: 'Green',
    focalLength_mm: 75,
    beamDiameter_mm: 7,
    transmission_pct: 90,
    scanSpeed_Hz: 500,
    mSquared: 1.05,
    maxAttackAngle_deg: 7.5,
    maxZTranslation_um: 1000,
    defaultNozzleWD_mm: 1.4,
    defaultNozzleAperture_mm: 1.0,
    isManual: true,
  },
];

export const HOLE_TYPES: readonly HoleTypeOption[] = [
  { id: 'round', excelCode: 'RD', name: 'Round Hole' },
  { id: 'square', excelCode: 'SQ', name: 'Square Hole' },
];

export function findLaserPreset(id: LaserId | string): LaserPreset {
  const normalizedId =
    id === 'FFPIR' ? 'CHARMILLES_IR' : id === 'FFPGR' ? 'CHARMILLES_GR' : id;
  return LASER_PRESETS.find((p) => p.id === normalizedId) ?? LASER_PRESETS[2];
}

export function findScanheadPreset(id: ScanheadId | string): ScanheadPreset {
  return SCANHEAD_PRESETS.find((p) => p.id === id) ?? SCANHEAD_PRESETS[1];
}

function pickFinite(override: number | null, fallback: number): number {
  return override !== null && Number.isFinite(override) ? override : fallback;
}

export function resolvePhysicsInput(input: CalculatorInput): ResolvedPhysicsInput {
  const laser = findLaserPreset(input.laserId);
  const scanhead = findScanheadPreset(input.scanheadId);

  const basePulseWidth_fs = laser.isManual
    ? input.manualLaserPulseWidth_fs
    : laser.pulseWidth_fs;
  const wavelength_um = laser.isManual
    ? input.manualLaserWavelength_um
    : laser.wavelength_um;
  const laserColor = laser.isManual ? input.manualLaserColor : laser.color;

  const scanheadBrand = scanhead.isManual
    ? input.manualScanheadBrand
    : scanhead.brand;
  const scanheadColor = scanhead.isManual
    ? input.manualScanheadColor
    : scanhead.color;
  const baseFocalLength_mm = scanhead.isManual
    ? input.manualScanheadFocalLength_mm
    : scanhead.focalLength_mm;
  const baseBeamDia_mm = scanhead.isManual
    ? input.manualScanheadBeamDia_mm
    : scanhead.beamDiameter_mm;
  const baseTransmission_pct = scanhead.isManual
    ? input.manualScanheadTransmission_pct
    : scanhead.transmission_pct;
  const baseM2 = scanhead.isManual ? input.manualScanheadM2 : scanhead.mSquared;
  const baseMaxAttack_deg = scanhead.isManual
    ? input.manualScanheadMaxAttack_deg
    : scanhead.maxAttackAngle_deg;
  const maxZTravel_um = scanhead.isManual
    ? input.manualScanheadMaxZTravel_um
    : scanhead.maxZTranslation_um;

  return {
    holeType: input.holeType,
    scanheadBrand,
    direction: input.direction,
    divergenceMode: input.divergenceMode,
    stateMode: input.stateMode,
    transitionProgress_pct: input.transitionProgress_pct,
    laserColor,
    scanheadColor,

    basePower_W: input.basePower_W,
    baseRepRate_kHz: input.baseRepRate_kHz,
    divider: input.divider,
    attenuator_pct: input.attenuator_pct,
    scanSpeed_Hz: input.scanSpeed_Hz,

    wavelength_um,
    pulseWidth_fs: pickFinite(input.pulseWidthOverride_fs, basePulseWidth_fs),
    focalLength_mm: pickFinite(input.focalLengthOverride_mm, baseFocalLength_mm),
    beamDiameter_mm: pickFinite(input.beamDiaOverride_mm, baseBeamDia_mm),
    mSquared: pickFinite(input.m2Override, baseM2),
    transmission_pct: pickFinite(input.transmissionOverride_pct, baseTransmission_pct),
    maxAttack_deg: pickFinite(input.maxAttackOverride_deg, baseMaxAttack_deg),
    maxZTravel_um,
    ablationThreshold_J_cm2: pickFinite(
      input.ablationThreshOverride_J_cm2,
      DEFAULT_ABLATION_THRESHOLD_J_CM2,
    ),
    focusRelZ_um: pickFinite(input.focusRelZ_um, 0),
    nozzleApertureDia_mm: pickFinite(input.nozzleApertureDia_mm, DEFAULT_NOZZLE_APERTURE_MM),
    nozzleWD_mm: pickFinite(input.nozzleWD_mm, DEFAULT_NOZZLE_WD_MM),
    nozzleThick_mm: pickFinite(input.nozzleThick_mm, DEFAULT_NOZZLE_THICK_MM),

    entranceDia_um: input.entranceDia_um,
    exitDia_um: input.exitDia_um,
    materialThick_um: input.materialThick_um,
    partSurface_Z_um: input.partSurface_Z_um,

    startDia_um: input.startDia_um,
    startAOI: input.startAOI,
    startZ: input.startZ,
    endDia_um: input.endDia_um,
    endAOI: input.endAOI,
    endZ: input.endZ,

    jobScaling: input.jobScaling,
    nodeScaling: input.nodeScaling,
    phase1_deg: input.phase1_deg,
    rotation1_deg: input.rotation1_deg,
    phase2_deg: input.phase2_deg,
    rotation2_deg: input.rotation2_deg,
    distXYRotation_deg: input.distXYRotation_deg,
    zFromFocusLookup_um: input.zFromFocusLookup_um,
  };
}

export const DEFAULT_CALCULATOR_INPUT: CalculatorInput = {
  laserId: 'CARBIDE_IR',
  scanheadId: 'SLIR',
  holeType: 'round',

  manualLaserWavelength_um: 0.515,
  manualLaserColor: 'Green',
  manualLaserPulseWidth_fs: 500,
  manualScanheadBrand: 'Scanlab',
  manualScanheadColor: 'Green',
  manualScanheadFocalLength_mm: 75,
  manualScanheadBeamDia_mm: 7,
  manualScanheadTransmission_pct: 90,
  manualScanheadScanSpeed_Hz: 500,
  manualScanheadM2: 1.05,
  manualScanheadMaxAttack_deg: 7.5,
  manualScanheadMaxZTravel_um: 1000,

  basePower_W: 40,
  baseRepRate_kHz: 200,
  divider: 4,
  attenuator_pct: 100,
  scanSpeed_Hz: 50,

  entranceDia_um: 203,
  exitDia_um: 653,
  materialThick_um: 2180,
  partSurface_Z_um: 0,
  stateMode: 'single',
  transitionProgress_pct: 0,
  startDia_um: 250,
  startAOI: -6,
  startZ: -1100,
  endDia_um: 350,
  endAOI: -7,
  endZ: -1100,
  jobScaling: 1,
  nodeScaling: 1,
  direction: 'CCW',
  phase1_deg: 0,
  rotation1_deg: 0,
  phase2_deg: 0,
  rotation2_deg: 180,
  distXYRotation_deg: 0,

  m2Override: null,
  pulseWidthOverride_fs: 500,
  focalLengthOverride_mm: null,
  beamDiaOverride_mm: null,
  transmissionOverride_pct: null,
  focusRelZ_um: null,
  nozzleApertureDia_mm: null,
  nozzleWD_mm: null,
  nozzleThick_mm: 2,
  maxAttackOverride_deg: null,
  ablationThreshOverride_J_cm2: 2,

  divergenceMode: 'current',
  zFromFocusLookup_um: 0,
  showCounterBeam: false,
  graphLimits: {
    zMin_um: -500,
    zMax_um: 1500,
    rMin_um: -80,
    rMax_um: 120,
  },
};
