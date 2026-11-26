/**
 * Pure WebAssembly loader for `src/wasm/engine.wasm` (zero Node-specific imports).
 * Copies output slices out of WASM linear memory so Transferable postMessage
 * never detaches the underlying WebAssembly.Memory buffer.
 */

import { resolvePhysicsInput } from '../data/presets.ts';
import {
  INPUT_LEN,
  OUTPUT_FLOAT_COUNT,
  packResolvedInput,
  unpackPhysicsOutput,
  type CalculatorInput,
  type PhysicsOutput,
  type ResolvedPhysicsInput,
} from '../types/physics.ts';

interface WasmPhysicsExports {
  memory: WebAssembly.Memory;
  getInputPtr(): number;
  getInputLength(): number;
  getOutputPtr(): number;
  getOutputLength(): number;
  compute(): void;
  computeFast?(): void;
}

export interface WasmPhysicsInstance {
  computeBufferFromResolved(resolved: ResolvedPhysicsInput, skipSweep?: boolean): Float64Array;
  computeBuffer(input: CalculatorInput): Float64Array;
  compute(input: CalculatorInput): PhysicsOutput;
}

function createWasmImports(): WebAssembly.Imports {
  return {
    env: {
      abort(): void {
        throw new Error('AssemblyScript WASM physics engine aborted');
      },
    },
  };
}

function wrapWasmExports(exports: WebAssembly.Exports): WasmPhysicsInstance {
  const raw = exports as unknown as Partial<WasmPhysicsExports>;
  if (
    !(raw.memory instanceof WebAssembly.Memory) ||
    typeof raw.getInputPtr !== 'function' ||
    typeof raw.getInputLength !== 'function' ||
    typeof raw.getOutputPtr !== 'function' ||
    typeof raw.getOutputLength !== 'function' ||
    typeof raw.compute !== 'function'
  ) {
    throw new Error('WASM module is missing required physics ABI exports');
  }

  const memory = raw.memory;
  const inputLen = raw.getInputLength();
  const outputLen = raw.getOutputLength();

  if (inputLen !== INPUT_LEN || outputLen !== OUTPUT_FLOAT_COUNT) {
    throw new Error(
      `WASM ABI buffer mismatch: expected (${INPUT_LEN}, ${OUTPUT_FLOAT_COUNT}), got (${inputLen}, ${outputLen})`,
    );
  }

  const inputPtr = raw.getInputPtr();
  const outputPtr = raw.getOutputPtr();
  const computeFn = raw.compute;
  const computeFastFn = typeof raw.computeFast === 'function' ? raw.computeFast : null;

  function computeBufferFromResolved(
    resolved: ResolvedPhysicsInput,
    skipSweep = false,
  ): Float64Array {
    const inputView = new Float64Array(memory.buffer, inputPtr, INPUT_LEN);
    packResolvedInput(resolved, inputView);
    if (skipSweep && computeFastFn) {
      computeFastFn();
    } else {
      computeFn();
    }
    const outputView = new Float64Array(
      memory.buffer,
      outputPtr,
      OUTPUT_FLOAT_COUNT,
    );
    // Return standalone copy so caller may transfer [buffer.buffer] safely
    return outputView.slice();
  }

  function computeBuffer(input: CalculatorInput): Float64Array {
    return computeBufferFromResolved(resolvePhysicsInput(input));
  }

  function compute(input: CalculatorInput): PhysicsOutput {
    return unpackPhysicsOutput(computeBuffer(input));
  }

  return {
    computeBufferFromResolved,
    computeBuffer,
    compute,
  };
}

export async function loadWasmPhysicsFromBytes(
  bytes: BufferSource,
): Promise<WasmPhysicsInstance> {
  const result = await WebAssembly.instantiate(bytes, createWasmImports());
  const instance =
    'instance' in result ? result.instance : (result as unknown as WebAssembly.Instance);
  return wrapWasmExports(instance.exports);
}

export async function loadWasmPhysicsFromUrl(
  url: URL | string = new URL('./engine.wasm', import.meta.url),
): Promise<WasmPhysicsInstance> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch WASM module (${response.status} ${response.statusText})`);
  }

  const imports = createWasmImports();
  if (typeof WebAssembly.instantiateStreaming === 'function') {
    try {
      const streamed = await WebAssembly.instantiateStreaming(
        response.clone(),
        imports,
      );
      return wrapWasmExports(streamed.instance.exports);
    } catch {
      // Fallback to ArrayBuffer instantiation if MIME type is not application/wasm
    }
  }

  const buffer = await response.arrayBuffer();
  return loadWasmPhysicsFromBytes(buffer);
}
