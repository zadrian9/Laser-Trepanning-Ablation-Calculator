/// <reference lib="webworker" />

/**
 * Dedicated Module Web Worker executing the AssemblyScript WASM physics kernel
 * with automatic TypeScript fallback and zero-copy Transferable Float64Array output.
 */

import { resolvePhysicsInput } from '../data/presets.ts';
import { computePhysicsBufferTS } from '../math/engine.ts';
import {
  OFFSETS,
  SWEEP_LEN,
  type ComputeBackend,
  type ResolvedPhysicsInput,
  type WorkerComputeRequest,
  type WorkerComputeResponse,
} from '../types/physics.ts';
import {
  loadWasmPhysicsFromUrl,
  type WasmPhysicsInstance,
} from '../wasm/loader.ts';

const ctx = self as unknown as DedicatedWorkerGlobalScope;

let wasmInstance: WasmPhysicsInstance | null = null;
let wasmInitPromise: Promise<WasmPhysicsInstance | null> | null = null;
let wasmFailed = false;

let lastSweepKey: string | null = null;
let lastSweepSlice: Float64Array | null = null;

function buildSweepCacheKey(r: ResolvedPhysicsInput): string {
  return [
    r.holeType,
    r.scanheadBrand,
    r.direction,
    r.laserColor,
    r.scanheadColor,
    r.basePower_W,
    r.baseRepRate_kHz,
    r.divider,
    r.attenuator_pct,
    r.scanSpeed_Hz,
    r.wavelength_um,
    r.pulseWidth_fs,
    r.focalLength_mm,
    r.beamDiameter_mm,
    r.mSquared,
    r.transmission_pct,
    r.maxAttack_deg,
    r.maxZTravel_um,
    r.ablationThreshold_J_cm2,
    r.focusRelZ_um,
    r.nozzleApertureDia_mm,
    r.nozzleWD_mm,
    r.nozzleThick_mm,
    r.entranceDia_um,
    r.exitDia_um,
    r.materialThick_um,
    r.partSurface_Z_um,
    r.startDia_um,
    r.startAOI,
    r.startZ,
    r.endDia_um,
    r.endAOI,
    r.endZ,
    r.jobScaling,
    r.nodeScaling,
    r.phase1_deg,
    r.rotation1_deg,
    r.phase2_deg,
    r.rotation2_deg,
    r.distXYRotation_deg,
  ].join('|');
}

async function ensureWasm(): Promise<WasmPhysicsInstance | null> {
  if (wasmFailed) return null;
  if (wasmInstance) return wasmInstance;
  if (!wasmInitPromise) {
    wasmInitPromise = loadWasmPhysicsFromUrl()
      .then((instance) => {
        wasmInstance = instance;
        return instance;
      })
      .catch(() => {
        wasmFailed = true;
        return null;
      });
  }
  return wasmInitPromise;
}

ctx.addEventListener('message', async (event: MessageEvent<WorkerComputeRequest>) => {
  const data = event.data as Partial<WorkerComputeRequest> | null | undefined;
  if (!data || typeof data !== 'object' || !data.input || typeof data.input !== 'object') {
    const empty = new Float64Array(0);
    const badResp: WorkerComputeResponse = {
      id: typeof data?.id === 'number' ? data.id : -1,
      backend: 'ts',
      computeMs: 0,
      buffer: empty,
      error: 'Invalid WorkerComputeRequest payload',
    };
    ctx.postMessage(badResp, [empty.buffer]);
    return;
  }

  const id = typeof data.id === 'number' ? data.id : -1;
  const input = data.input;
  const t0 = performance.now();
  const resolved = resolvePhysicsInput(input);

  let backend: ComputeBackend = 'ts';
  let buffer: Float64Array;
  let errorMsg: string | undefined;

  const sweepKey = buildSweepCacheKey(resolved);
  const canReuseSweep = lastSweepKey === sweepKey && lastSweepSlice !== null;

  const wasm = await ensureWasm();
  if (wasm && !wasmFailed) {
    try {
      buffer = wasm.computeBufferFromResolved(resolved, canReuseSweep);
      backend = 'wasm';
    } catch (err) {
      wasmFailed = true;
      errorMsg = err instanceof Error ? err.message : String(err);
      buffer = computePhysicsBufferTS(resolved, undefined, canReuseSweep);
      backend = 'ts';
    }
  } else {
    buffer = computePhysicsBufferTS(resolved, undefined, canReuseSweep);
    backend = 'ts';
  }

  if (canReuseSweep && lastSweepSlice) {
    buffer.set(lastSweepSlice, OFFSETS.TRANSITION_SWEEP);
  } else {
    lastSweepKey = sweepKey;
    lastSweepSlice = buffer.slice(
      OFFSETS.TRANSITION_SWEEP,
      OFFSETS.TRANSITION_SWEEP + SWEEP_LEN,
    );
  }

  const computeMs = performance.now() - t0;
  const response: WorkerComputeResponse = errorMsg
    ? { id, backend, computeMs, buffer, error: errorMsg }
    : { id, backend, computeMs, buffer };

  ctx.postMessage(response, [buffer.buffer]);
});
