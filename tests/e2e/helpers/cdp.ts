import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BROWSER_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter((p): p is string => Boolean(p));

export function findHeadlessBrowserExecutable(): string {
  for (const candidate of BROWSER_CANDIDATES) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  throw new Error(
    `No Chrome/Edge executable found. Checked: ${BROWSER_CANDIDATES.join(', ')}`,
  );
}

interface CdpMessage {
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
  sessionId?: string;
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
}

type PendingCall = {
  resolve: (value: Record<string, unknown>) => void;
  reject: (err: Error) => void;
};

export interface FailedRequestRecord {
  url: string;
  status: number | string;
}

export class CdpSession {
  private readonly proc: ChildProcess;
  private readonly ws: WebSocket;
  private readonly userDataDir: string;
  private nextId = 1;
  private readonly pending = new Map<number, PendingCall>();
  private readonly eventListeners = new Map<
    string,
    Set<(params: Record<string, unknown>) => void>
  >();
  private sessionId = '';
  private closed = false;
  private wasmBlocked = false;
  private readonly requestUrls = new Map<string, string>();

  public consoleErrors: string[] = [];
  public pageErrors: string[] = [];
  public failedRequests: FailedRequestRecord[] = [];
  public ignoreFailedUrlsMatching: RegExp | null = null;

  private constructor(proc: ChildProcess, ws: WebSocket, userDataDir: string) {
    this.proc = proc;
    this.ws = ws;
    this.userDataDir = userDataDir;

    this.ws.addEventListener('message', (event) => {
      const raw = typeof event.data === 'string' ? event.data : String(event.data);
      const msg = JSON.parse(raw) as CdpMessage;
      if (typeof msg.id === 'number') {
        const call = this.pending.get(msg.id);
        if (call) {
          this.pending.delete(msg.id);
          if (msg.error) {
            call.reject(new Error(`CDP error ${msg.error.code}: ${msg.error.message}`));
          } else {
            call.resolve(msg.result ?? {});
          }
        }
        return;
      }

      if (msg.method) {
        const listeners = this.eventListeners.get(msg.method);
        if (listeners) {
          for (const cb of listeners) {
            cb(msg.params ?? {});
          }
        }
      }
    });

    this.ws.addEventListener('close', () => {
      this.rejectAllPending(new Error('CDP WebSocket closed unexpectedly'));
    });

    this.ws.addEventListener('error', () => {
      this.rejectAllPending(new Error('CDP WebSocket encountered an unexpected error'));
    });
  }

  private rejectAllPending(err: Error): void {
    for (const [, call] of this.pending) {
      call.reject(err);
    }
    this.pending.clear();
  }

  private static waitForProcessExit(proc: ChildProcess, timeoutMs: number): Promise<boolean> {
    if (proc.exitCode !== null || proc.signalCode !== null) {
      return Promise.resolve(true);
    }
    return new Promise<boolean>((resolve) => {
      let settled = false;
      const onExit = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(true);
      };
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        proc.off('exit', onExit);
        resolve(proc.exitCode !== null || proc.signalCode !== null);
      }, timeoutMs);
      proc.once('exit', onExit);
    });
  }

  private static async terminateProcessTree(proc: ChildProcess): Promise<void> {
    if (proc.exitCode !== null || proc.signalCode !== null) {
      return;
    }

    const exited = CdpSession.waitForProcessExit(proc, 1500);
    if (process.platform === 'win32' && proc.pid) {
      try {
        spawnSync('taskkill', ['/PID', String(proc.pid), '/T', '/F'], {
          stdio: 'ignore',
          windowsHide: true,
        });
      } catch {
        // ignore
      }
      if (proc.exitCode === null && proc.signalCode === null) {
        try {
          proc.kill();
        } catch {
          // ignore
        }
      }
    } else {
      try {
        proc.kill('SIGTERM');
      } catch {
        // ignore
      }
    }

    const didExit = await exited;
    if (!didExit && proc.exitCode === null && proc.signalCode === null) {
      const killed = CdpSession.waitForProcessExit(proc, 500);
      try {
        proc.kill('SIGKILL');
      } catch {
        // ignore
      }
      await killed;
    }
  }

  private static async removeUserDataDir(userDataDir: string): Promise<void> {
    const maxAttempts = 25;
    const retryDelayMs = 200;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (!fs.existsSync(userDataDir)) {
        return;
      }
      try {
        fs.rmSync(userDataDir, {
          recursive: true,
          force: true,
        });
        if (!fs.existsSync(userDataDir)) {
          return;
        }
      } catch {
        // Retry below on transient Windows file locks (EBUSY / EPERM / ENOTEMPTY / EACCES)
      }
      if (attempt < maxAttempts - 1) {
        await new Promise((r) => setTimeout(r, retryDelayMs));
      }
    }
  }

  private static async cleanupLaunchFailure(
    proc: ChildProcess | null,
    ws: WebSocket | null,
    userDataDir: string,
  ): Promise<void> {
    try {
      ws?.close();
    } catch {
      // ignore
    }
    if (proc) {
      await CdpSession.terminateProcessTree(proc);
    }
    await CdpSession.removeUserDataDir(userDataDir);
  }

  static async launch(options?: {
    width?: number;
    height?: number;
    deviceScaleFactor?: number;
  }): Promise<CdpSession> {
    const exe = findHeadlessBrowserExecutable();
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ltc-e2e-cdp-'));
    let proc: ChildProcess | null = null;
    let ws: WebSocket | null = null;
    let session: CdpSession | null = null;

    try {
      proc = spawn(
        exe,
        [
          '--headless=new',
          '--disable-gpu',
          '--no-sandbox',
          '--disable-dev-shm-usage',
          '--disable-background-networking',
          '--disable-component-update',
          '--metrics-recording-only',
          '--no-service-autorun',
          '--no-first-run',
          '--no-default-browser-check',
          '--remote-debugging-port=0',
          `--user-data-dir=${userDataDir}`,
          'about:blank',
        ],
        { stdio: ['ignore', 'pipe', 'pipe'] },
      );
      const childProc = proc;

      const wsUrl = await new Promise<string>((resolve, reject) => {
        let buffer = '';
        let settled = false;
        const cleanupListeners = () => {
          childProc.stderr?.off('data', onData);
          childProc.stdout?.off('data', onData);
          childProc.off('exit', onExit);
          childProc.off('error', onError);
        };
        const timer = setTimeout(() => {
          if (settled) return;
          settled = true;
          cleanupListeners();
          reject(new Error(`Timed out waiting for DevTools ws URL from ${exe}. Output: ${buffer}`));
        }, 12000);

        const onData = (chunk: Buffer) => {
          buffer += chunk.toString('utf8');
          const match = buffer.match(/DevTools listening on (ws:\/\/[^\s]+)/);
          if (match && !settled) {
            settled = true;
            clearTimeout(timer);
            cleanupListeners();
            resolve(match[1]);
          }
        };

        const onExit = (code: number | null) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          cleanupListeners();
          reject(new Error(`Browser exited prematurely with code ${code}: ${buffer}`));
        };

        const onError = (spawnErr: Error) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          cleanupListeners();
          reject(spawnErr);
        };

        childProc.stderr?.on('data', onData);
        childProc.stdout?.on('data', onData);
        childProc.once('exit', onExit);
        childProc.once('error', onError);
      });

      const socket = new WebSocket(wsUrl);
      ws = socket;
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('WebSocket connect timeout')), 8000);
        socket.addEventListener('open', () => {
          clearTimeout(timer);
          resolve();
        }, { once: true });
        socket.addEventListener('error', (err) => {
          clearTimeout(timer);
          reject(new Error(`WebSocket error: ${String(err)}`));
        }, { once: true });
      });

      session = new CdpSession(childProc, socket, userDataDir);
      await session.attachInitialPage(options);
      return session;
    } catch (err) {
      if (session) {
        await session.close().catch(() => undefined);
      } else {
        await CdpSession.cleanupLaunchFailure(proc, ws, userDataDir);
      }
      throw err;
    }
  }

  private async attachInitialPage(options?: {
    width?: number;
    height?: number;
    deviceScaleFactor?: number;
  }): Promise<void> {
    const created = await this.sendBrowser('Target.createTarget', { url: 'about:blank' });
    const targetId = String(created.targetId);
    const attached = await this.sendBrowser('Target.attachToTarget', {
      targetId,
      flatten: true,
    });
    this.sessionId = String(attached.sessionId);

    this.on('Runtime.consoleAPICalled', (params) => {
      if (params.type === 'error') {
        const args = (params.args as Array<{ value?: unknown; description?: string }>) ?? [];
        const text = args.map((a) => String(a.description ?? a.value ?? '')).join(' ');
        this.consoleErrors.push(text);
      }
    });

    this.on('Runtime.exceptionThrown', (params) => {
      const details = params.exceptionDetails as
        | { text?: string; exception?: { description?: string } }
        | undefined;
      const msg = details?.exception?.description ?? details?.text ?? 'Uncaught page exception';
      this.pageErrors.push(msg);
    });

    this.on('Network.requestWillBeSent', (params) => {
      const reqId = params.requestId;
      const req = params.request as { url?: string } | undefined;
      if (typeof reqId === 'string' && req?.url) {
        this.requestUrls.set(reqId, req.url);
      }
    });

    this.on('Network.responseReceived', (params) => {
      const response = params.response as { url?: string; status?: number } | undefined;
      if (response && typeof response.status === 'number' && response.status >= 400) {
        const url = response.url ?? '';
        if (!this.ignoreFailedUrlsMatching?.test(url)) {
          this.failedRequests.push({ url, status: response.status });
        }
      }
    });

    this.on('Network.loadingFailed', (params) => {
      const errorText = String(params.errorText ?? 'loadingFailed');
      if (errorText === 'net::ERR_ABORTED') return;
      const reqId = typeof params.requestId === 'string' ? params.requestId : '';
      const url = this.requestUrls.get(reqId) ?? reqId;
      const blocked = this.wasmBlocked && errorText === 'net::ERR_FAILED';
      if (!blocked && !this.ignoreFailedUrlsMatching?.test(url)) {
        this.failedRequests.push({ url, status: errorText });
      }
    });

    await this.send('Page.enable');
    await this.send('Runtime.enable');
    await this.send('Network.enable');
    await this.send('DOM.enable');
    await this.setViewport(
      options?.width ?? 1280,
      options?.height ?? 860,
      options?.deviceScaleFactor ?? 1,
    );
  }

  public on(method: string, cb: (params: Record<string, unknown>) => void): () => void {
    let set = this.eventListeners.get(method);
    if (!set) {
      set = new Set();
      this.eventListeners.set(method, set);
    }
    set.add(cb);
    return () => {
      set?.delete(cb);
    };
  }

  public sendBrowser(
    method: string,
    params: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> {
    return this.rawSend(method, params, undefined);
  }

  public send(
    method: string,
    params: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> {
    return this.rawSend(method, params, this.sessionId);
  }

  private rawSend(
    method: string,
    params: Record<string, unknown>,
    sessionId: string | undefined,
  ): Promise<Record<string, unknown>> {
    if (this.closed) {
      return Promise.reject(new Error(`CDP session closed before ${method}`));
    }
    const id = this.nextId++;
    const payload: Record<string, unknown> = { id, method, params };
    if (sessionId) {
      payload.sessionId = sessionId;
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP call ${method} timed out`));
      }, 15000);

      this.pending.set(id, {
        resolve: (val) => {
          clearTimeout(timer);
          resolve(val);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      });
      try {
        this.ws.send(JSON.stringify(payload));
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  public async addScriptToEvaluateOnNewDocument(source: string): Promise<string> {
    const res = await this.send('Page.addScriptToEvaluateOnNewDocument', { source });
    return String(res.identifier ?? '');
  }

  public clearLogs(): void {
    this.consoleErrors = [];
    this.pageErrors = [];
    this.failedRequests = [];
  }

  private waitForLoadEvent(timeoutMsg: string): {
    promise: Promise<void>;
    cleanup: () => void;
  } {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let off: (() => void) | null = null;
    const cleanup = () => {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      if (off !== null) {
        off();
        off = null;
      }
    };
    const promise = new Promise<void>((resolve, reject) => {
      off = this.on('Page.loadEventFired', () => {
        cleanup();
        resolve();
      });
      timer = setTimeout(() => {
        cleanup();
        reject(new Error(timeoutMsg));
      }, 15000);
    });
    return { promise, cleanup };
  }

  public async navigate(url: string): Promise<void> {
    const { promise, cleanup } = this.waitForLoadEvent(
      `Timed out waiting for Page.loadEventFired at ${url}`,
    );
    try {
      await this.send('Page.navigate', { url });
      await promise;
    } finally {
      cleanup();
    }
  }

  public async reload(ignoreCache = false): Promise<void> {
    const { promise, cleanup } = this.waitForLoadEvent(
      'Timed out waiting for Page.loadEventFired on reload',
    );
    try {
      await this.send('Page.reload', { ignoreCache });
      await promise;
    } finally {
      cleanup();
    }
  }

  public async evaluate<T = unknown>(expression: string): Promise<T> {
    const res = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    const exc = res.exceptionDetails as
      | { text?: string; exception?: { description?: string } }
      | undefined;
    if (exc) {
      throw new Error(exc.exception?.description ?? exc.text ?? 'Runtime.evaluate exception');
    }
    const result = res.result as { value?: T } | undefined;
    return result?.value as T;
  }

  public async waitFor<T = unknown>(
    predicateExpr: string,
    timeoutMs = 8000,
    intervalMs = 50,
  ): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const val = await this.evaluate<T>(predicateExpr);
      if (val) return val;
      await new Promise((r) => setTimeout(r, intervalMs));
    }
    throw new Error(`Timed out after ${timeoutMs}ms waiting for: ${predicateExpr}`);
  }

  public async setViewport(
    width: number,
    height: number,
    deviceScaleFactor = 1,
  ): Promise<void> {
    await this.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor,
      mobile: width < 600,
    });
  }

  public async setOffline(offline: boolean): Promise<void> {
    await this.send('Network.emulateNetworkConditions', {
      offline,
      latency: 0,
      downloadThroughput: -1,
      uploadThroughput: -1,
    });
  }

  public async blockWasmWith404(): Promise<void> {
    this.wasmBlocked = true;
    this.ignoreFailedUrlsMatching = /\.wasm(\?.*)?$/i;
    await this.send('Fetch.enable', {
      patterns: [{ urlPattern: '*.wasm*' }],
    });
    this.on('Fetch.requestPaused', (params) => {
      const requestId = String(params.requestId);
      void this.send('Fetch.fulfillRequest', {
        requestId,
        responseCode: 404,
        responseHeaders: [{ name: 'Content-Type', value: 'text/plain' }],
        body: '',
      }).catch(() => undefined);
    });
  }

  public async mouseMove(x: number, y: number): Promise<void> {
    await this.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x,
      y,
      button: 'none',
    });
  }

  public async mouseDrag(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    steps = 5,
  ): Promise<void> {
    await this.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: x1,
      y: y1,
      button: 'left',
      clickCount: 1,
    });
    for (let i = 1; i <= steps; i++) {
      const x = x1 + ((x2 - x1) * i) / steps;
      const y = y1 + ((y2 - y1) * i) / steps;
      await this.send('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x,
        y,
        button: 'left',
        buttons: 1,
      });
    }
    await this.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: x2,
      y: y2,
      button: 'left',
      clickCount: 1,
    });
  }

  public async wheel(x: number, y: number, deltaY: number): Promise<void> {
    await this.send('Input.dispatchMouseEvent', {
      type: 'mouseWheel',
      x,
      y,
      deltaX: 0,
      deltaY,
    });
  }

  public async clickAt(x: number, y: number): Promise<void> {
    await this.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x,
      y,
      button: 'left',
      clickCount: 1,
    });
    await this.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x,
      y,
      button: 'left',
      clickCount: 1,
    });
  }

  public async pressKey(key: string, code: string, windowsVirtualKeyCode: number): Promise<void> {
    await this.send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key,
      code,
      windowsVirtualKeyCode,
      nativeVirtualKeyCode: windowsVirtualKeyCode,
    });
    await this.send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key,
      code,
      windowsVirtualKeyCode,
      nativeVirtualKeyCode: windowsVirtualKeyCode,
    });
  }

  public async touchPinchAndCancel(cx: number, cy: number): Promise<void> {
    await this.send('Emulation.setTouchEmulationEnabled', { enabled: true });
    await this.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [
        { x: cx - 30, y: cy, id: 1 },
        { x: cx + 30, y: cy, id: 2 },
      ],
    });
    await this.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [
        { x: cx - 60, y: cy, id: 1 },
        { x: cx + 60, y: cy, id: 2 },
      ],
    });
    await this.send('Input.dispatchTouchEvent', {
      type: 'touchCancel',
      touchPoints: [],
    });
    await this.send('Emulation.setTouchEmulationEnabled', { enabled: false });
  }

  public async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;

    for (const [, call] of this.pending) {
      call.reject(new Error('CDP session closed'));
    }
    this.pending.clear();

    if (
      this.proc.exitCode === null &&
      this.proc.signalCode === null &&
      this.ws.readyState === WebSocket.OPEN
    ) {
      let sent = false;
      try {
        this.ws.send(JSON.stringify({ id: this.nextId++, method: 'Browser.close', params: {} }));
        sent = true;
      } catch {
        // ignore
      }
      if (sent) {
        await CdpSession.waitForProcessExit(this.proc, 1500);
      }
    }

    try {
      this.ws.close();
    } catch {
      // ignore
    }

    await CdpSession.terminateProcessTree(this.proc);
    await CdpSession.removeUserDataDir(this.userDataDir);
  }
}

export async function withCdpPage<T>(
  fn: (page: CdpSession) => Promise<T>,
  options?: { width?: number; height?: number; deviceScaleFactor?: number },
): Promise<T> {
  const session = await CdpSession.launch(options);
  try {
    return await fn(session);
  } finally {
    await session.close();
  }
}
