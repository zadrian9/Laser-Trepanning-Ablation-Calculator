/**
 * Main-thread async client for the physics Web Worker with sequence-ID
 * stale-response dropping and automatic TypeScript fallback when Worker is unavailable.
 */

import { computePhysicsTS } from '../math/engine.ts';
import {
  unpackPhysicsOutput,
  type CalculatorInput,
  type ComputeBackend,
  type PhysicsOutput,
  type WorkerComputeRequest,
  type WorkerComputeResponse,
} from '../types/physics.ts';

export interface PhysicsComputeResult {
  id: number;
  backend: ComputeBackend;
  computeMs: number;
  output: PhysicsOutput;
}

interface PendingRequest {
  id: number;
  input: CalculatorInput;
  resolve: (result: PhysicsComputeResult | null) => void;
  reject: (err: unknown) => void;
}

export class PhysicsClient {
  private worker: Worker | null = null;
  private latestId = 0;
  private inFlight: PendingRequest | null = null;
  private queued: PendingRequest | null = null;
  private lastBackend: ComputeBackend = 'ts';
  private lastComputeMs = 0;
  private disposed = false;

  constructor(useWorker = typeof Worker !== 'undefined') {
    if (useWorker) {
      try {
        this.worker = new Worker(
          new URL('./physics.worker.ts', import.meta.url),
          { type: 'module' },
        );
        this.worker.addEventListener('message', this.handleMessage);
        this.worker.addEventListener('error', this.handleError);
      } catch {
        this.worker = null;
      }
    }
  }

  private dispatchNext(): void {
    if (!this.worker || this.inFlight || !this.queued) return;
    const next = this.queued;
    this.queued = null;
    this.inFlight = next;
    const request: WorkerComputeRequest = { id: next.id, input: next.input };
    this.worker.postMessage(request);
  }

  private handleMessage = (event: MessageEvent<WorkerComputeResponse>): void => {
    const msg = event.data;
    const req = this.inFlight;
    if (!req || req.id !== msg.id) {
      return;
    }
    this.inFlight = null;

    // Immediately kick off the latest queued request before resolving
    const hasNewerQueued = this.queued !== null || msg.id < this.latestId;
    this.dispatchNext();

    // Drop superseded response without unpacking buffer
    if (hasNewerQueued) {
      req.resolve(null);
      return;
    }

    if (msg.error && msg.buffer.length === 0) {
      req.reject(new Error(msg.error));
      return;
    }

    try {
      const output = unpackPhysicsOutput(msg.buffer);
      this.lastBackend = msg.backend;
      this.lastComputeMs = msg.computeMs;
      req.resolve({
        id: msg.id,
        backend: msg.backend,
        computeMs: msg.computeMs,
        output,
      });
    } catch (err) {
      req.reject(err);
    }
  };

  private handleError = (event: ErrorEvent): void => {
    // Reject pending worker requests and fall back to TS for future requests
    const err = new Error(event.message || 'Physics worker error');
    const active = this.inFlight;
    const next = this.queued;
    this.inFlight = null;
    this.queued = null;
    active?.reject(err);
    next?.reject(err);
    this.worker?.terminate();
    this.worker = null;
  };

  compute(input: CalculatorInput): Promise<PhysicsComputeResult | null> {
    if (this.disposed) {
      return Promise.reject(new Error('PhysicsClient has been terminated'));
    }

    const id = ++this.latestId;

    if (this.worker) {
      return new Promise<PhysicsComputeResult | null>((resolve, reject) => {
        if (this.queued) {
          this.queued.resolve(null);
        }
        this.queued = { id, input, resolve, reject };
        this.dispatchNext();
      });
    }

    // Fallback when Worker API is unavailable (e.g., SSR / Node Vitest)
    const t0 = performance.now();
    const output = computePhysicsTS(input);
    const computeMs = performance.now() - t0;
    this.lastBackend = 'ts';
    this.lastComputeMs = computeMs;
    return Promise.resolve({
      id,
      backend: 'ts',
      computeMs,
      output,
    });
  }

  getLastBackend(): ComputeBackend {
    return this.lastBackend;
  }

  getLastComputeMs(): number {
    return this.lastComputeMs;
  }

  terminate(): void {
    this.disposed = true;
    this.inFlight?.resolve(null);
    this.queued?.resolve(null);
    this.inFlight = null;
    this.queued = null;
    if (this.worker) {
      this.worker.removeEventListener('message', this.handleMessage);
      this.worker.removeEventListener('error', this.handleError);
      this.worker.terminate();
      this.worker = null;
    }
  }
}
