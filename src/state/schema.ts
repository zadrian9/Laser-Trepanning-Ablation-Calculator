/**
 * Application state schema, deep cloning, CalculatorInput projection,
 * and strict JSON import validation with prototype-pollution protection.
 */

import {
  DEFAULT_CALCULATOR_INPUT,
  HOLE_TYPES,
  LASER_PRESETS,
  SCANHEAD_PRESETS,
} from '../data/presets.ts';
import type { FluenceUnitMode } from '../render/fluenceCanvas.ts';
import {
  DEFAULT_ISOFLUENCE_VISIBILITY,
  type IsofluenceContourKey,
  type IsofluenceVisibility,
} from '../render/isofluenceCanvas.ts';
import type {
  GraphLimitFitMode,
  ProfileOrientation,
} from '../render/profileCanvas.ts';
import type { TopDownMode } from '../render/topDownCanvas.ts';
import type {
  CalculatorInput,
  ColorType,
  Direction,
  DivergenceMode,
  GraphLimits,
  HoleType,
  LaserId,
  ScanheadBrand,
  ScanheadId,
  StateMode,
} from '../types/physics.ts';

export type TabId = 'profile' | 'topdown' | 'isofluence' | 'fluence';

export interface AppState extends CalculatorInput {
  orientation: ProfileOrientation;
  activeTab: TabId;
  tab2Mode: TopDownMode;
  showNozzleRings: boolean;
  orbitAngleDeg: number;
  visibleSlicePlanes: [boolean, boolean, boolean, boolean, boolean, boolean];
  isofluenceVisibility: IsofluenceVisibility;
  fluenceUnitMode: FluenceUnitMode;
  showProfileNozzle: boolean;
  profileFitMode: GraphLimitFitMode;
}

export const DEFAULT_VISIBLE_SLICE_PLANES: readonly [
  boolean,
  boolean,
  boolean,
  boolean,
  boolean,
  boolean,
] = [true, true, true, true, true, true];

export const DEFAULT_STATE: AppState = {
  ...DEFAULT_CALCULATOR_INPUT,
  graphLimits: { ...DEFAULT_CALCULATOR_INPUT.graphLimits },
  orientation: 'vertical',
  activeTab: 'profile',
  tab2Mode: 'all',
  showNozzleRings: true,
  orbitAngleDeg: 0,
  visibleSlicePlanes: [...DEFAULT_VISIBLE_SLICE_PLANES] as [
    boolean,
    boolean,
    boolean,
    boolean,
    boolean,
    boolean,
  ],
  isofluenceVisibility: { ...DEFAULT_ISOFLUENCE_VISIBILITY },
  fluenceUnitMode: 'normalized',
  showProfileNozzle: true,
  profileFitMode: 'expand',
};

export type ValidationResult =
  | { ok: true; state: AppState }
  | { ok: false; errors: string[] };

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const MAX_CONFIG_JSON_BYTES = 262_144; // 256 KB

const VALID_LASER_IDS = new Set<string>(LASER_PRESETS.map((p) => p.id));
const VALID_SCANHEAD_IDS = new Set<string>(SCANHEAD_PRESETS.map((p) => p.id));
const VALID_HOLE_TYPES = new Set<string>(HOLE_TYPES.map((h) => h.id));
const VALID_COLORS = new Set<ColorType>(['IR', 'Green']);
const VALID_BRANDS = new Set<ScanheadBrand>(['Arges', 'Scanlab']);
const VALID_DIRECTIONS = new Set<Direction>(['CCW', 'CW']);
const VALID_DIVERGENCE_MODES = new Set<DivergenceMode>(['current', 'legacy']);
const VALID_STATE_MODES = new Set<StateMode>(['single', 'transition']);
const VALID_ORIENTATIONS = new Set<ProfileOrientation>(['vertical', 'horizontal']);
const VALID_TABS = new Set<TabId>(['profile', 'topdown', 'isofluence', 'fluence']);
const VALID_TAB2_MODES = new Set<TopDownMode>([
  'beam_path',
  'contour_1e2',
  'contour_ablation',
  'all',
]);
const VALID_FLUENCE_UNITS = new Set<FluenceUnitMode>(['normalized', 'fluence']);
const VALID_FIT_MODES = new Set<GraphLimitFitMode>(['expand', 'exact']);

const ISOFLUENCE_KEYS = Object.keys(
  DEFAULT_ISOFLUENCE_VISIBILITY,
) as IsofluenceContourKey[];

const GRAPH_LIMIT_KEYS: readonly (keyof GraphLimits)[] = [
  'zMin_um',
  'zMax_um',
  'rMin_um',
  'rMax_um',
];

interface NumberBound {
  min: number;
  max: number;
  exclusiveMin?: boolean;
}

const REQUIRED_NUMBER_BOUNDS: Readonly<Record<string, NumberBound>> = {
  manualLaserWavelength_um: { min: 0.1, max: 20 },
  manualLaserPulseWidth_fs: { min: 1, max: 1e9 },
  manualScanheadFocalLength_mm: { min: 1, max: 2000 },
  manualScanheadBeamDia_mm: { min: 0.1, max: 200 },
  manualScanheadTransmission_pct: { min: 0.1, max: 100 },
  manualScanheadScanSpeed_Hz: { min: 0.1, max: 100_000 },
  manualScanheadM2: { min: 1.0, max: 20 },
  manualScanheadMaxAttack_deg: { min: 0.1, max: 60 },
  manualScanheadMaxZTravel_um: { min: 0, max: 100_000 },

  basePower_W: { min: 0, max: 100_000 },
  baseRepRate_kHz: { min: 0, max: 100_000, exclusiveMin: true },
  divider: { min: 1, max: 10_000 },
  attenuator_pct: { min: 0, max: 100 },
  scanSpeed_Hz: { min: 0, max: 100_000, exclusiveMin: true },

  entranceDia_um: { min: 0, max: 100_000 },
  exitDia_um: { min: 0, max: 100_000 },
  materialThick_um: { min: 1, max: 100_000 },
  partSurface_Z_um: { min: -50_000, max: 50_000 },
  transitionProgress_pct: { min: 0, max: 100 },
  startDia_um: { min: 0, max: 100_000 },
  startAOI: { min: -100, max: 100 },
  startZ: { min: -50_000, max: 50_000 },
  endDia_um: { min: 0, max: 100_000 },
  endAOI: { min: -100, max: 100 },
  endZ: { min: -50_000, max: 50_000 },
  jobScaling: { min: 0.01, max: 100 },
  nodeScaling: { min: 0.01, max: 100 },
  phase1_deg: { min: -360, max: 360 },
  rotation1_deg: { min: -360, max: 360 },
  phase2_deg: { min: -360, max: 360 },
  rotation2_deg: { min: -360, max: 360 },
  distXYRotation_deg: { min: -360, max: 360 },

  zFromFocusLookup_um: { min: -50_000, max: 50_000 },
  orbitAngleDeg: { min: 0, max: 360 },
};

const OVERRIDE_NUMBER_BOUNDS: Readonly<Record<string, NumberBound>> = {
  m2Override: { min: 1.0, max: 20 },
  pulseWidthOverride_fs: { min: 1, max: 1e9 },
  focalLengthOverride_mm: { min: 0, max: 2000, exclusiveMin: true },
  beamDiaOverride_mm: { min: 0, max: 200, exclusiveMin: true },
  transmissionOverride_pct: { min: 0.1, max: 100 },
  focusRelZ_um: { min: -50_000, max: 50_000 },
  nozzleApertureDia_mm: { min: 0.01, max: 100 },
  nozzleWD_mm: { min: 0, max: 200 },
  nozzleThick_mm: { min: 0, max: 100 },
  maxAttackOverride_deg: { min: 0.1, max: 60 },
  ablationThreshOverride_J_cm2: { min: 0, max: 10_000, exclusiveMin: true },
};

const OPTIONAL_UI_KEYS = new Set<string>([
  'showProfileNozzle',
  'profileFitMode',
]);

const REQUIRED_APP_STATE_KEYS = new Set<string>(
  Object.keys(DEFAULT_STATE).filter((k) => !OPTIONAL_UI_KEYS.has(k)),
);

const ALL_ALLOWED_KEYS = new Set<string>(Object.keys(DEFAULT_STATE));

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function checkFiniteBounds(
  key: string,
  val: unknown,
  bound: NumberBound,
  errors: string[],
): number | null {
  if (typeof val !== 'number' || !Number.isFinite(val)) {
    errors.push(`Field '${key}' must be a finite number`);
    return null;
  }
  const minOk = bound.exclusiveMin ? val > bound.min : val >= bound.min;
  if (!minOk || val > bound.max) {
    const op = bound.exclusiveMin ? '>' : '>=';
    errors.push(`Field '${key}' must be ${op} ${bound.min} and <= ${bound.max}`);
    return null;
  }
  return val;
}

function checkEnum<T extends string>(
  key: string,
  val: unknown,
  allowed: ReadonlySet<T | string>,
  errors: string[],
): T | null {
  if (typeof val !== 'string' || !allowed.has(val)) {
    errors.push(`Field '${key}' has invalid value`);
    return null;
  }
  return val as T;
}

export function cloneAppState(state: AppState): AppState {
  return {
    ...state,
    graphLimits: { ...state.graphLimits },
    visibleSlicePlanes: [...state.visibleSlicePlanes] as [
      boolean,
      boolean,
      boolean,
      boolean,
      boolean,
      boolean,
    ],
    isofluenceVisibility: { ...state.isofluenceVisibility },
  };
}

export function toCalculatorInput(state: AppState): CalculatorInput {
  return {
    laserId: state.laserId,
    scanheadId: state.scanheadId,
    holeType: state.holeType,

    manualLaserWavelength_um: state.manualLaserWavelength_um,
    manualLaserColor: state.manualLaserColor,
    manualLaserPulseWidth_fs: state.manualLaserPulseWidth_fs,
    manualScanheadBrand: state.manualScanheadBrand,
    manualScanheadColor: state.manualScanheadColor,
    manualScanheadFocalLength_mm: state.manualScanheadFocalLength_mm,
    manualScanheadBeamDia_mm: state.manualScanheadBeamDia_mm,
    manualScanheadTransmission_pct: state.manualScanheadTransmission_pct,
    manualScanheadScanSpeed_Hz: state.manualScanheadScanSpeed_Hz,
    manualScanheadM2: state.manualScanheadM2,
    manualScanheadMaxAttack_deg: state.manualScanheadMaxAttack_deg,
    manualScanheadMaxZTravel_um: state.manualScanheadMaxZTravel_um,

    basePower_W: state.basePower_W,
    baseRepRate_kHz: state.baseRepRate_kHz,
    divider: state.divider,
    attenuator_pct: state.attenuator_pct,
    scanSpeed_Hz: state.scanSpeed_Hz,

    entranceDia_um: state.entranceDia_um,
    exitDia_um: state.exitDia_um,
    materialThick_um: state.materialThick_um,
    partSurface_Z_um: state.partSurface_Z_um,
    stateMode: state.stateMode,
    transitionProgress_pct: state.transitionProgress_pct,
    startDia_um: state.startDia_um,
    startAOI: state.startAOI,
    startZ: state.startZ,
    endDia_um: state.endDia_um,
    endAOI: state.endAOI,
    endZ: state.endZ,
    jobScaling: state.jobScaling,
    nodeScaling: state.nodeScaling,
    direction: state.direction,
    phase1_deg: state.phase1_deg,
    rotation1_deg: state.rotation1_deg,
    phase2_deg: state.phase2_deg,
    rotation2_deg: state.rotation2_deg,
    distXYRotation_deg: state.distXYRotation_deg,

    m2Override: state.m2Override,
    pulseWidthOverride_fs: state.pulseWidthOverride_fs,
    focalLengthOverride_mm: state.focalLengthOverride_mm,
    beamDiaOverride_mm: state.beamDiaOverride_mm,
    transmissionOverride_pct: state.transmissionOverride_pct,
    focusRelZ_um: state.focusRelZ_um,
    nozzleApertureDia_mm: state.nozzleApertureDia_mm,
    nozzleWD_mm: state.nozzleWD_mm,
    nozzleThick_mm: state.nozzleThick_mm,
    maxAttackOverride_deg: state.maxAttackOverride_deg,
    ablationThreshOverride_J_cm2: state.ablationThreshOverride_J_cm2,

    divergenceMode: state.divergenceMode,
    zFromFocusLookup_um: state.zFromFocusLookup_um,
    showCounterBeam: state.showCounterBeam,
    graphLimits: { ...state.graphLimits },
  };
}

export function serializeAppState(state: AppState): string {
  return JSON.stringify(cloneAppState(state), null, 2);
}

export function validateAppState(raw: unknown): ValidationResult {
  const errors: string[] = [];

  if (!isPlainObject(raw)) {
    return { ok: false, errors: ['Configuration root must be a plain JSON object'] };
  }

  const ownKeys = Object.getOwnPropertyNames(raw);
  for (const key of ownKeys) {
    if (FORBIDDEN_KEYS.has(key)) {
      errors.push(`Forbidden key '${key}' detected`);
    } else if (!ALL_ALLOWED_KEYS.has(key)) {
      errors.push(`Unknown key '${key}'`);
    }
  }

  for (const reqKey of REQUIRED_APP_STATE_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(raw, reqKey)) {
      errors.push(`Missing required key '${reqKey}'`);
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  // Enums
  const laserId = checkEnum<LaserId>('laserId', raw.laserId, VALID_LASER_IDS, errors);
  const scanheadId = checkEnum<ScanheadId>(
    'scanheadId',
    raw.scanheadId,
    VALID_SCANHEAD_IDS,
    errors,
  );
  const holeType = checkEnum<HoleType>('holeType', raw.holeType, VALID_HOLE_TYPES, errors);
  const manualLaserColor = checkEnum<ColorType>(
    'manualLaserColor',
    raw.manualLaserColor,
    VALID_COLORS,
    errors,
  );
  const manualScanheadBrand = checkEnum<ScanheadBrand>(
    'manualScanheadBrand',
    raw.manualScanheadBrand,
    VALID_BRANDS,
    errors,
  );
  const manualScanheadColor = checkEnum<ColorType>(
    'manualScanheadColor',
    raw.manualScanheadColor,
    VALID_COLORS,
    errors,
  );
  const stateMode = checkEnum<StateMode>('stateMode', raw.stateMode, VALID_STATE_MODES, errors);
  const direction = checkEnum<Direction>('direction', raw.direction, VALID_DIRECTIONS, errors);
  const divergenceMode = checkEnum<DivergenceMode>(
    'divergenceMode',
    raw.divergenceMode,
    VALID_DIVERGENCE_MODES,
    errors,
  );
  const orientation = checkEnum<ProfileOrientation>(
    'orientation',
    raw.orientation,
    VALID_ORIENTATIONS,
    errors,
  );
  const activeTab = checkEnum<TabId>('activeTab', raw.activeTab, VALID_TABS, errors);
  const tab2Mode = checkEnum<TopDownMode>('tab2Mode', raw.tab2Mode, VALID_TAB2_MODES, errors);
  const fluenceUnitMode = checkEnum<FluenceUnitMode>(
    'fluenceUnitMode',
    raw.fluenceUnitMode,
    VALID_FLUENCE_UNITS,
    errors,
  );

  let profileFitMode: GraphLimitFitMode = DEFAULT_STATE.profileFitMode;
  if (Object.prototype.hasOwnProperty.call(raw, 'profileFitMode')) {
    const parsed = checkEnum<GraphLimitFitMode>(
      'profileFitMode',
      raw.profileFitMode,
      VALID_FIT_MODES,
      errors,
    );
    if (parsed) profileFitMode = parsed;
  }

  // Booleans
  if (typeof raw.showCounterBeam !== 'boolean') {
    errors.push(`Field 'showCounterBeam' must be a boolean`);
  }
  if (typeof raw.showNozzleRings !== 'boolean') {
    errors.push(`Field 'showNozzleRings' must be a boolean`);
  }
  let showProfileNozzle = DEFAULT_STATE.showProfileNozzle;
  if (Object.prototype.hasOwnProperty.call(raw, 'showProfileNozzle')) {
    if (typeof raw.showProfileNozzle !== 'boolean') {
      errors.push(`Field 'showProfileNozzle' must be a boolean`);
    } else {
      showProfileNozzle = raw.showProfileNozzle;
    }
  }

  // Required finite numbers
  const nums: Record<string, number> = {};
  for (const [key, bound] of Object.entries(REQUIRED_NUMBER_BOUNDS)) {
    const checked = checkFiniteBounds(key, raw[key], bound, errors);
    if (checked !== null) {
      nums[key] = checked;
    }
  }

  // Nullable overrides
  const overrides: Record<string, number | null> = {};
  for (const [key, bound] of Object.entries(OVERRIDE_NUMBER_BOUNDS)) {
    const val = raw[key];
    if (val === null) {
      overrides[key] = null;
    } else {
      const checked = checkFiniteBounds(key, val, bound, errors);
      overrides[key] = checked;
    }
  }

  // Nested: graphLimits
  let sanitizedGraphLimits: GraphLimits = { ...DEFAULT_STATE.graphLimits };
  if (!isPlainObject(raw.graphLimits)) {
    errors.push(`Field 'graphLimits' must be a plain object`);
  } else {
    const glKeys = Object.getOwnPropertyNames(raw.graphLimits);
    for (const k of glKeys) {
      if (FORBIDDEN_KEYS.has(k)) {
        errors.push(`Forbidden key '${k}' in 'graphLimits'`);
      } else if (!GRAPH_LIMIT_KEYS.includes(k as keyof GraphLimits)) {
        errors.push(`Unknown key '${k}' in 'graphLimits'`);
      }
    }
    for (const reqK of GRAPH_LIMIT_KEYS) {
      if (!Object.prototype.hasOwnProperty.call(raw.graphLimits, reqK)) {
        errors.push(`Missing key '${reqK}' in 'graphLimits'`);
      }
    }
    const zMin = checkFiniteBounds(
      'graphLimits.zMin_um',
      raw.graphLimits.zMin_um,
      { min: -100_000, max: 100_000 },
      errors,
    );
    const zMax = checkFiniteBounds(
      'graphLimits.zMax_um',
      raw.graphLimits.zMax_um,
      { min: -100_000, max: 100_000 },
      errors,
    );
    const rMin = checkFiniteBounds(
      'graphLimits.rMin_um',
      raw.graphLimits.rMin_um,
      { min: -100_000, max: 100_000 },
      errors,
    );
    const rMax = checkFiniteBounds(
      'graphLimits.rMax_um',
      raw.graphLimits.rMax_um,
      { min: -100_000, max: 100_000 },
      errors,
    );
    if (zMin !== null && zMax !== null && rMin !== null && rMax !== null) {
      sanitizedGraphLimits = {
        zMin_um: Math.min(zMin, zMax),
        zMax_um: Math.max(zMin, zMax),
        rMin_um: Math.min(rMin, rMax),
        rMax_um: Math.max(rMin, rMax),
      };
    }
  }

  // Nested: visibleSlicePlanes
  let sanitizedSlices: [boolean, boolean, boolean, boolean, boolean, boolean] = [
    ...DEFAULT_VISIBLE_SLICE_PLANES,
  ];
  if (
    !Array.isArray(raw.visibleSlicePlanes) ||
    raw.visibleSlicePlanes.length !== 6 ||
    !raw.visibleSlicePlanes.every((v) => typeof v === 'boolean')
  ) {
    errors.push(`Field 'visibleSlicePlanes' must be an array of 6 booleans`);
  } else {
    sanitizedSlices = [
      raw.visibleSlicePlanes[0],
      raw.visibleSlicePlanes[1],
      raw.visibleSlicePlanes[2],
      raw.visibleSlicePlanes[3],
      raw.visibleSlicePlanes[4],
      raw.visibleSlicePlanes[5],
    ];
  }

  // Nested: isofluenceVisibility
  const sanitizedIsoVis: IsofluenceVisibility = { ...DEFAULT_ISOFLUENCE_VISIBILITY };
  if (!isPlainObject(raw.isofluenceVisibility)) {
    errors.push(`Field 'isofluenceVisibility' must be a plain object`);
  } else {
    const ivKeys = Object.getOwnPropertyNames(raw.isofluenceVisibility);
    for (const k of ivKeys) {
      if (FORBIDDEN_KEYS.has(k)) {
        errors.push(`Forbidden key '${k}' in 'isofluenceVisibility'`);
      } else if (!ISOFLUENCE_KEYS.includes(k as IsofluenceContourKey)) {
        errors.push(`Unknown key '${k}' in 'isofluenceVisibility'`);
      }
    }
    for (const reqK of ISOFLUENCE_KEYS) {
      if (!Object.prototype.hasOwnProperty.call(raw.isofluenceVisibility, reqK)) {
        errors.push(`Missing key '${reqK}' in 'isofluenceVisibility'`);
      } else if (typeof raw.isofluenceVisibility[reqK] !== 'boolean') {
        errors.push(`Field 'isofluenceVisibility.${reqK}' must be a boolean`);
      } else {
        sanitizedIsoVis[reqK] = raw.isofluenceVisibility[reqK] as boolean;
      }
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const sanitized: AppState = {
    laserId: laserId!,
    scanheadId: scanheadId!,
    holeType: holeType!,

    manualLaserWavelength_um: nums.manualLaserWavelength_um,
    manualLaserColor: manualLaserColor!,
    manualLaserPulseWidth_fs: nums.manualLaserPulseWidth_fs,
    manualScanheadBrand: manualScanheadBrand!,
    manualScanheadColor: manualScanheadColor!,
    manualScanheadFocalLength_mm: nums.manualScanheadFocalLength_mm,
    manualScanheadBeamDia_mm: nums.manualScanheadBeamDia_mm,
    manualScanheadTransmission_pct: nums.manualScanheadTransmission_pct,
    manualScanheadScanSpeed_Hz: nums.manualScanheadScanSpeed_Hz,
    manualScanheadM2: nums.manualScanheadM2,
    manualScanheadMaxAttack_deg: nums.manualScanheadMaxAttack_deg,
    manualScanheadMaxZTravel_um: nums.manualScanheadMaxZTravel_um,

    basePower_W: nums.basePower_W,
    baseRepRate_kHz: nums.baseRepRate_kHz,
    divider: Math.round(nums.divider),
    attenuator_pct: nums.attenuator_pct,
    scanSpeed_Hz: nums.scanSpeed_Hz,

    entranceDia_um: nums.entranceDia_um,
    exitDia_um: nums.exitDia_um,
    materialThick_um: nums.materialThick_um,
    partSurface_Z_um: nums.partSurface_Z_um,
    stateMode: stateMode!,
    transitionProgress_pct: nums.transitionProgress_pct,
    startDia_um: nums.startDia_um,
    startAOI: nums.startAOI,
    startZ: nums.startZ,
    endDia_um: nums.endDia_um,
    endAOI: nums.endAOI,
    endZ: nums.endZ,
    jobScaling: nums.jobScaling,
    nodeScaling: nums.nodeScaling,
    direction: direction!,
    phase1_deg: nums.phase1_deg,
    rotation1_deg: nums.rotation1_deg,
    phase2_deg: nums.phase2_deg,
    rotation2_deg: nums.rotation2_deg,
    distXYRotation_deg: nums.distXYRotation_deg,

    m2Override: overrides.m2Override,
    pulseWidthOverride_fs: overrides.pulseWidthOverride_fs,
    focalLengthOverride_mm: overrides.focalLengthOverride_mm,
    beamDiaOverride_mm: overrides.beamDiaOverride_mm,
    transmissionOverride_pct: overrides.transmissionOverride_pct,
    focusRelZ_um: overrides.focusRelZ_um,
    nozzleApertureDia_mm: overrides.nozzleApertureDia_mm,
    nozzleWD_mm: overrides.nozzleWD_mm,
    nozzleThick_mm: overrides.nozzleThick_mm,
    maxAttackOverride_deg: overrides.maxAttackOverride_deg,
    ablationThreshOverride_J_cm2: overrides.ablationThreshOverride_J_cm2,

    divergenceMode: divergenceMode!,
    zFromFocusLookup_um: nums.zFromFocusLookup_um,
    showCounterBeam: raw.showCounterBeam as boolean,
    graphLimits: sanitizedGraphLimits,

    orientation: orientation!,
    activeTab: activeTab!,
    tab2Mode: tab2Mode!,
    showNozzleRings: raw.showNozzleRings as boolean,
    orbitAngleDeg: nums.orbitAngleDeg,
    visibleSlicePlanes: sanitizedSlices,
    isofluenceVisibility: sanitizedIsoVis,
    fluenceUnitMode: fluenceUnitMode!,
    showProfileNozzle,
    profileFitMode,
  };

  return { ok: true, state: sanitized };
}

export function parseAndValidateConfigJson(jsonText: string): ValidationResult {
  if (typeof jsonText !== 'string' || jsonText.trim().length === 0) {
    return { ok: false, errors: ['Configuration file is empty'] };
  }
  if (jsonText.length > MAX_CONFIG_JSON_BYTES) {
    return {
      ok: false,
      errors: [`Configuration file exceeds maximum size (${MAX_CONFIG_JSON_BYTES} bytes)`],
    };
  }

  const forbiddenFound: string[] = [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText, (key, value) => {
      if (FORBIDDEN_KEYS.has(key)) {
        forbiddenFound.push(key);
        return undefined;
      }
      return value;
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Invalid JSON syntax';
    return { ok: false, errors: [`Invalid JSON: ${msg}`] };
  }

  if (forbiddenFound.length > 0) {
    return {
      ok: false,
      errors: forbiddenFound.map((k) => `Forbidden key '${k}' detected`),
    };
  }

  return validateAppState(parsed);
}
