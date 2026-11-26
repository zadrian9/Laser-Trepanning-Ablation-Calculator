import fs from 'node:fs';
import http from 'node:http';
import { createServer, type ViteDevServer } from 'vite';
import { assertDeliverableExists, WORKSPACE_ROOT } from './env.ts';

export type HoleType = 'round' | 'square';
export type ColorType = 'IR' | 'Green';
export type ScanheadBrand = 'Arges' | 'Scanlab';
export type Direction = 'CCW' | 'CW';
export type DivergenceMode = 'current' | 'legacy';
export type StateMode = 'single' | 'transition';

export interface GraphLimitsContract {
  zMin_um: number;
  zMax_um: number;
  rMin_um: number;
  rMax_um: number;
}

export interface CalculatorInputContract {
  laserId: string;
  scanheadId: string;
  holeType: HoleType;
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
  basePower_W: number;
  baseRepRate_kHz: number;
  divider: number;
  attenuator_pct: number;
  scanSpeed_Hz: number;
  entranceDia_um: number;
  exitDia_um: number;
  materialThick_um: number;
  partSurface_Z_um: number;
  stateMode: StateMode;
  transitionProgress_pct: number;
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
  divergenceMode: DivergenceMode;
  zFromFocusLookup_um: number;
  showCounterBeam: boolean;
  graphLimits: GraphLimitsContract;
}

export interface PhysicsScalarsContract {
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
  thresholdRatio: number;
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
  nozzlePlane1Z_um: number;
  nozzlePlane2Z_um: number;
  aoiSquareScaling: number;
  totalXYScaling: number;
  [key: string]: unknown;
}

export interface TrepanningPathContract {
  theta: Float64Array;
  planeZ: Float64Array;
  planeW: Float64Array;
  planeRAbl: Float64Array;
  planeCenterXY: Float64Array;
  plane1e2XY: Float64Array;
  planeAblXY: Float64Array;
  holeEntranceXY: Float64Array;
  holeExitXY: Float64Array;
}

export interface PhysicsOutputContract {
  scalars: PhysicsScalarsContract;
  focusDist: Float64Array;
  thresholdRatio?: number;
  isofluence: Float64Array;
  trepanningProfile: Float64Array;
  trepanningPath: TrepanningPathContract;
  transitionSweep: Float64Array;
}

export interface LaserPresetContract {
  id: string;
  excelCode?: string;
  name: string;
  pulseWidth_fs: number;
  wavelength_um: number;
  color: ColorType;
  defaultPower_W: number;
  defaultRepRate_kHz: number;
  defaultAttenuator_pct: number;
  defaultDivider: number;
  isManual?: boolean;
}

export interface ScanheadPresetContract {
  id: string;
  excelCode?: string;
  name: string;
  brand: ScanheadBrand;
  color: ColorType;
  focalLength_mm: number;
  beamDiameter_mm: number;
  transmission_pct: number;
  scanSpeed_Hz: number;
  mSquared: number;
  maxAttackAngle_deg: number;
  maxZTranslation_um: number;
  isManual?: boolean;
}

export interface HoleTypeContract {
  id: HoleType;
  excelCode?: string;
  name: string;
}

export interface PresetsContract {
  LASER_PRESETS: readonly LaserPresetContract[];
  SCANHEAD_PRESETS: readonly ScanheadPresetContract[];
  HOLE_TYPES: readonly HoleTypeContract[];
  DEFAULT_CALCULATOR_INPUT: CalculatorInputContract;
}

export interface WasmRunnerContract {
  compute: (input: CalculatorInputContract) => PhysicsOutputContract;
  rawBufferByteLength?: (input: CalculatorInputContract) => number;
}

let sharedViteServer: ViteDevServer | null = null;

async function getViteSsrServer(): Promise<ViteDevServer> {
  if (!sharedViteServer) {
    sharedViteServer = await createServer({
      root: WORKSPACE_ROOT,
      server: { middlewareMode: true, hmr: false, ws: false },
      appType: 'custom',
      optimizeDeps: { noDiscovery: true },
      logLevel: 'silent',
    });
  }
  return sharedViteServer;
}

export async function closeViteSsrServer(): Promise<void> {
  if (sharedViteServer) {
    const srv = sharedViteServer;
    sharedViteServer = null;
    await srv.close();
  }
}

async function loadPublicModule<T extends Record<string, unknown>>(
  relPath: string,
  milestoneHint: string,
): Promise<T> {
  assertDeliverableExists(relPath, milestoneHint);
  const srv = await getViteSsrServer();
  return (await srv.ssrLoadModule(`/${relPath}`)) as T;
}

export async function loadPresetsContract(): Promise<PresetsContract> {
  const mod = await loadPublicModule<Record<string, unknown>>('src/data/presets.ts', 'M2');
  const lasers = mod.LASER_PRESETS as LaserPresetContract[] | undefined;
  const scanheads = mod.SCANHEAD_PRESETS as ScanheadPresetContract[] | undefined;
  const holeTypes = mod.HOLE_TYPES as HoleTypeContract[] | undefined;
  const defaultInput =
    (mod.DEFAULT_CALCULATOR_INPUT as CalculatorInputContract | undefined) ??
    (typeof mod.createDefaultCalculatorInput === 'function'
      ? (mod.createDefaultCalculatorInput as () => CalculatorInputContract)()
      : undefined);

  if (!Array.isArray(lasers) || !Array.isArray(scanheads) || !Array.isArray(holeTypes)) {
    throw new Error('Waiting for M2: src/data/presets.ts missing LASER_PRESETS/SCANHEAD_PRESETS/HOLE_TYPES');
  }
  if (!defaultInput) {
    throw new Error('Waiting for M2: src/data/presets.ts missing DEFAULT_CALCULATOR_INPUT');
  }
  return {
    LASER_PRESETS: lasers,
    SCANHEAD_PRESETS: scanheads,
    HOLE_TYPES: holeTypes,
    DEFAULT_CALCULATOR_INPUT: structuredClone(defaultInput),
  };
}

export function cloneDefaultInput(presets: PresetsContract): CalculatorInputContract {
  return structuredClone(presets.DEFAULT_CALCULATOR_INPUT);
}

export function findLaserByName(
  presets: PresetsContract,
  nameSubstring: string,
): LaserPresetContract {
  const found = presets.LASER_PRESETS.find((p) =>
    p.name.toLowerCase().includes(nameSubstring.toLowerCase()),
  );
  if (!found) {
    throw new Error(`Laser preset matching "${nameSubstring}" not found in LASER_PRESETS`);
  }
  return found;
}

export function findScanheadByName(
  presets: PresetsContract,
  nameSubstring: string,
): ScanheadPresetContract {
  const found = presets.SCANHEAD_PRESETS.find((p) =>
    p.name.toLowerCase().includes(nameSubstring.toLowerCase()),
  );
  if (!found) {
    throw new Error(`Scanhead preset matching "${nameSubstring}" not found in SCANHEAD_PRESETS`);
  }
  return found;
}

function normalizePhysicsOutput(raw: unknown): PhysicsOutputContract {
  const out = raw as Record<string, unknown>;
  if (!out || typeof out !== 'object' || !out.scalars) {
    throw new Error('Invalid PhysicsOutput shape returned by physics engine');
  }
  const scalars = out.scalars as PhysicsScalarsContract;
  const focusDist = out.focusDist as Float64Array;
  const thresholdRatio =
    typeof out.thresholdRatio === 'number'
      ? out.thresholdRatio
      : typeof (out as { focusDistThresholdRatio?: number }).focusDistThresholdRatio === 'number'
        ? (out as { focusDistThresholdRatio: number }).focusDistThresholdRatio
        : typeof scalars.thresholdRatio === 'number'
          ? scalars.thresholdRatio
          : undefined;
  return {
    ...(out as unknown as PhysicsOutputContract),
    scalars,
    focusDist,
    thresholdRatio,
  };
}

export async function loadTsEngineContract(): Promise<
  (input: CalculatorInputContract) => PhysicsOutputContract
> {
  const mod = await loadPublicModule<Record<string, unknown>>('src/math/engine.ts', 'M2');
  const fn =
    mod.computePhysicsTS ??
    mod.computePhysicsSync ??
    mod.computePhysics ??
    mod.calculatePhysics ??
    mod.runPhysics ??
    mod.default;

  if (typeof fn !== 'function') {
    throw new Error('Waiting for M2: src/math/engine.ts does not export computePhysicsSync');
  }
  return (input: CalculatorInputContract) =>
    normalizePhysicsOutput((fn as (i: CalculatorInputContract) => unknown)(input));
}

export async function loadWasmRunnerContract(): Promise<WasmRunnerContract> {
  const wasmPath = assertDeliverableExists('src/wasm/engine.wasm', 'M2');
  const mod = await loadPublicModule<Record<string, unknown>>('src/wasm/loader.ts', 'M2');
  const wasmBytes = fs.readFileSync(wasmPath);

  const bytesLoader =
    mod.loadWasmPhysicsFromBytes ??
    mod.loadWasmFromBytes ??
    mod.instantiateWasmPhysics ??
    mod.loadWasmEngineFromBytes ??
    mod.loadWasmEngine ??
    mod.loadWasmPhysics;

  if (typeof bytesLoader !== 'function') {
    throw new Error('Waiting for M2: src/wasm/loader.ts missing WASM loader export');
  }

  const instance = (await (bytesLoader as (b: Uint8Array) => Promise<Record<string, unknown>>)(
    new Uint8Array(wasmBytes),
  )) as Record<string, unknown> | ((i: CalculatorInputContract) => unknown);

  if (typeof instance === 'function') {
    return {
      compute: (input) => normalizePhysicsOutput(instance(input)),
    };
  }

  const computeMethod =
    instance.compute ?? instance.computePhysics ?? instance.run ?? instance.calculate;
  if (typeof computeMethod === 'function') {
    return {
      compute: (input) =>
        normalizePhysicsOutput((computeMethod as (i: CalculatorInputContract) => unknown).call(instance, input)),
    };
  }

  const computeBufferMethod = instance.computeToBuffer ?? instance.computeBuffer;
  let unpackFn = mod.unpackPhysicsBuffer ?? mod.unpackPhysicsOutput ?? instance.unpack;
  if (typeof unpackFn !== 'function' && fs.existsSync(WORKSPACE_ROOT + '/src/types/physics.ts')) {
    const typesMod = await loadPublicModule<Record<string, unknown>>('src/types/physics.ts', 'M2');
    unpackFn = typesMod.unpackPhysicsOutput;
  }
  if (typeof computeBufferMethod === 'function' && typeof unpackFn === 'function') {
    return {
      compute: (input) => {
        const buf = (computeBufferMethod as (i: CalculatorInputContract) => Float64Array).call(
          instance,
          input,
        );
        return normalizePhysicsOutput((unpackFn as (b: Float64Array) => unknown)(buf));
      },
      rawBufferByteLength: (input) => {
        const buf = (computeBufferMethod as (i: CalculatorInputContract) => Float64Array).call(
          instance,
          input,
        );
        return buf.byteLength;
      },
    };
  }

  throw new Error('Waiting for M2: unsupported WASM loader instance interface in src/wasm/loader.ts');
}

export interface SchemaContract {
  validateAndParse: (rawJson: string) => { ok: true; data: CalculatorInputContract } | { ok: false; error: string };
  exportJson: (input: CalculatorInputContract) => string;
}

export async function loadSchemaContract(): Promise<SchemaContract> {
  const mod = await loadPublicModule<Record<string, unknown>>('src/state/schema.ts', 'M4');

  const parseAndValidateFn =
    mod.parseAndValidateConfigJson ??
    mod.parseConfigJson ??
    mod.importConfigJson ??
    mod.validateConfigJson ??
    mod.validateConfig ??
    mod.validateCalculatorInput ??
    mod.parseCalculatorConfig;

  const validateObjFn = mod.validateAppState;

  const validateFn: ((raw: string) => unknown) | null =
    typeof parseAndValidateFn === 'function'
      ? (raw: string) => (parseAndValidateFn as (input: unknown) => unknown)(raw)
      : typeof validateObjFn === 'function'
        ? (raw: string) => {
            const parsed = JSON.parse(raw);
            return (validateObjFn as (input: unknown) => unknown)(parsed);
          }
        : null;

  const exportFn =
    mod.serializeAppState ??
    mod.exportConfigJson ??
    mod.serializeConfig ??
    mod.serializeCalculatorInput;

  if (typeof validateFn !== 'function') {
    throw new Error('Waiting for M4: src/state/schema.ts missing JSON config validator export');
  }

  return {
    validateAndParse(rawJson: string) {
      try {
        const res = validateFn(rawJson);
        if (res && typeof res === 'object') {
          const obj = res as Record<string, unknown>;
          if ('ok' in obj) {
            return obj.ok
              ? {
                  ok: true,
                  data: (obj.data ?? obj.value ?? obj.config ?? obj.state) as CalculatorInputContract,
                }
              : {
                  ok: false,
                  error: Array.isArray(obj.errors)
                    ? obj.errors.map(String).join('; ')
                    : String(obj.error ?? obj.errors ?? obj.message ?? 'Validation failed'),
                };
          }
          if ('valid' in obj) {
            return obj.valid
              ? {
                  ok: true,
                  data: (obj.data ?? obj.value ?? obj.config ?? obj.state) as CalculatorInputContract,
                }
              : {
                  ok: false,
                  error: Array.isArray(obj.errors)
                    ? obj.errors.map(String).join('; ')
                    : String(obj.error ?? obj.errors ?? 'Validation failed'),
                };
          }
          if ('laserId' in obj && 'scanheadId' in obj) {
            return { ok: true, data: obj as unknown as CalculatorInputContract };
          }
        }
        return { ok: false, error: 'Unexpected schema validator return value' };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
    exportJson(input: CalculatorInputContract) {
      if (typeof exportFn === 'function') {
        const base =
          mod.DEFAULT_STATE && typeof mod.DEFAULT_STATE === 'object'
            ? structuredClone(mod.DEFAULT_STATE as Record<string, unknown>)
            : {};
        const payload = {
          ...base,
          ...input,
          graphLimits: {
            ...((base.graphLimits as Record<string, unknown> | undefined) ?? {}),
            ...input.graphLimits,
          },
        };
        const out = (exportFn as (i: unknown) => unknown)(payload);
        return typeof out === 'string' ? out : JSON.stringify(out, null, 2);
      }
      return JSON.stringify(input, null, 2);
    },
  };
}

export interface WorkerHarnessServer {
  url: string;
  close: () => Promise<void>;
}

export async function startViteWorkerHarnessServer(): Promise<WorkerHarnessServer> {
  assertDeliverableExists('src/worker/physicsClient.ts', 'M2');
  assertDeliverableExists('src/worker/physics.worker.ts', 'M2');
  assertDeliverableExists('src/data/presets.ts', 'M2');

  const vite = await createServer({
    root: WORKSPACE_ROOT,
    server: { middlewareMode: true, hmr: false, ws: false },
    appType: 'custom',
    optimizeDeps: { noDiscovery: true },
    logLevel: 'silent',
  });

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>E2E Worker Harness</title></head>
<body>
<script type="module">
  import * as presetsMod from '/src/data/presets.ts';
  import * as clientMod from '/src/worker/physicsClient.ts';

  const ClientCtor = clientMod.PhysicsClient || clientMod.default;
  const createClient = clientMod.createPhysicsClient || (() => new ClientCtor());
  const client = createClient();

  window.__e2eWorker = {
    presetsMod,
    clientMod,
    client,
    compute: (input) => {
      if (typeof client.compute === 'function') return client.compute(input);
      if (typeof client.calculate === 'function') return client.calculate(input);
      if (typeof client.request === 'function') return client.request(input);
      throw new Error('No compute/calculate/request method on PhysicsClient');
    },
    defaultInput: structuredClone(presetsMod.DEFAULT_CALCULATOR_INPUT),
    rawWorkerTest: () => new Promise((resolve) => {
      const w = new Worker(new URL('/src/worker/physics.worker.ts', import.meta.url), { type: 'module' });
      let settled = false;
      const done = (res) => { if (!settled) { settled = true; w.terminate(); resolve(res); } };
      w.addEventListener('message', (ev) => done({ type: 'message', data: ev.data }));
      w.addEventListener('error', (ev) => done({ type: 'error', message: ev.message }));
      w.postMessage({ bogus: true, id: 'bad-payload' });
      setTimeout(() => done({ type: 'timeout-survived' }), 400);
    }),
  };
  window.__e2eReady = true;
</script>
</body>
</html>`;

  const httpServer = http.createServer((req, res) => {
    const reqUrl = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (reqUrl.pathname === '/__e2e_worker_harness.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }
    vite.middlewares(req, res, () => {
      res.writeHead(404);
      res.end('Not found');
    });
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(0, '127.0.0.1', () => resolve());
  });

  const addr = httpServer.address();
  if (!addr || typeof addr === 'string') {
    await vite.close();
    throw new Error('Failed to bind ephemeral port for Vite worker harness');
  }

  return {
    url: `http://127.0.0.1:${addr.port}/__e2e_worker_harness.html`,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        httpServer.close((err) => (err ? reject(err) : resolve()));
      });
      await vite.close();
    },
  };
}
