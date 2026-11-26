import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const WORKSPACE_ROOT = path.resolve(__dirname, '..', '..', '..');

export const FORBIDDEN_REPO_FILES = [
  '*.xlsx',
  'inspect_*.py',
  'dump_specs.py',
  'test_math.py',
  'main_cells.txt',
  'defined_names.json',
  'sheet_*.json',
] as const;

export const GOLDEN_DEFAULT = {
  pulseEnergyBase_uJ: 200,
  pulseEnergyOutput_uJ: 180,
  avgPower_W: 9,
  peakPower_MW: 338.19742033187447,
  spotSize_um: 15.531248803724818,
  rayleighRange_um: 151.2783974388781,
  peakFluence_J_cm2: 190.02024139849135,
  peakIrradiance_TW_cm2: 357.02419695449908,
  avgIrradiance_MW_cm2: 9.5010120699245668,
  scanSpeed_mm_s: 54.977871437821378,
  spotOverlap_pct: 92.92035403815872,
  ablatedSpotAt0_um: 23.436194934586272,
  thresholdR: 1.5089704138256823,
  energyAboveThresh_pct: 98.947480549819005,
  exitAperture1MaxR_um: 605.22561808244359,
  exitAperture2MaxR_um: 258.62092000484904,
  nozzleClipping: true,
  attackAngle_rad: 0.12127132349586267,
} as const;

export function resolveWorkspacePath(...segments: string[]): string {
  return path.resolve(WORKSPACE_ROOT, ...segments);
}

export function assertDeliverableExists(relPath: string, milestoneHint: string): string {
  const absPath = resolveWorkspacePath(relPath);
  if (!fs.existsSync(absPath)) {
    throw new Error(`Waiting for ${milestoneHint}: missing ${relPath}`);
  }
  return absPath;
}

export function walkFiles(dirAbs: string, baseAbs = dirAbs): string[] {
  if (!fs.existsSync(dirAbs)) {
    return [];
  }
  const results: string[] = [];
  for (const entry of fs.readdirSync(dirAbs, { withFileTypes: true })) {
    const full = path.join(dirAbs, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkFiles(full, baseAbs));
    } else if (entry.isFile()) {
      results.push(path.relative(baseAbs, full).replace(/\\/g, '/'));
    }
  }
  return results.sort();
}

export function expectClose(
  actual: number,
  expected: number,
  relTol = 1e-5,
  label = 'value',
): void {
  expect(Number.isFinite(actual), `${label} should be finite (got ${actual})`).toBe(true);
  if (expected === 0) {
    expect(Math.abs(actual), `${label} expected ~0, got ${actual}`).toBeLessThanOrEqual(relTol);
    return;
  }
  const relErr = Math.abs(actual - expected) / Math.abs(expected);
  expect(
    relErr,
    `${label}: expected ${expected}, got ${actual} (relErr=${relErr} > tol=${relTol})`,
  ).toBeLessThanOrEqual(relTol);
}

export interface PngInfo {
  width: number;
  height: number;
  bitDepth: number;
  colorType: number;
  topLeftPixelRGBA: [number, number, number, number];
}

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function paethPredictor(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

export function parsePngInfo(filePath: string): PngInfo {
  const buf = fs.readFileSync(filePath);
  if (buf.length < 33 || !buf.subarray(0, 8).equals(PNG_MAGIC)) {
    throw new Error(`Invalid PNG signature in ${filePath}`);
  }

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idatChunks: Buffer[] = [];
  let plte: Buffer | null = null;
  let trns: Buffer | null = null;

  while (offset + 12 <= buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.subarray(offset + 4, offset + 8).toString('ascii');
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > buf.length) {
      throw new Error(`Truncated PNG chunk ${type} in ${filePath}`);
    }
    const chunkData = buf.subarray(dataStart, dataEnd);
    if (type === 'IHDR') {
      width = chunkData.readUInt32BE(0);
      height = chunkData.readUInt32BE(4);
      bitDepth = chunkData.readUInt8(8);
      colorType = chunkData.readUInt8(9);
    } else if (type === 'PLTE') {
      plte = chunkData;
    } else if (type === 'tRNS') {
      trns = chunkData;
    } else if (type === 'IDAT') {
      idatChunks.push(chunkData);
    } else if (type === 'IEND') {
      break;
    }
    offset = dataEnd + 4;
  }

  if (width <= 0 || height <= 0 || idatChunks.length === 0) {
    throw new Error(`Missing IHDR or IDAT in PNG ${filePath}`);
  }

  const inflated = zlib.inflateSync(Buffer.concat(idatChunks));
  const channels =
    colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 4 ? 2 : 1;
  const bytesPerPixel = Math.max(1, Math.ceil((channels * bitDepth) / 8));
  const stride = width * bytesPerPixel;
  const filterType = inflated.readUInt8(0);
  const rawPixel0 = new Uint8Array(bytesPerPixel);

  for (let i = 0; i < bytesPerPixel; i++) {
    const x = inflated.readUInt8(1 + i);
    const a = 0;
    const b = 0;
    const c = 0;
    let recon = x;
    switch (filterType) {
      case 0:
        recon = x;
        break;
      case 1:
        recon = (x + a) & 0xff;
        break;
      case 2:
        recon = (x + b) & 0xff;
        break;
      case 3:
        recon = (x + ((a + b) >> 1)) & 0xff;
        break;
      case 4:
        recon = (x + paethPredictor(a, b, c)) & 0xff;
        break;
      default:
        if (stride < 0) break;
        recon = x;
    }
    rawPixel0[i] = recon;
  }

  if (bitDepth !== 8) {
    throw new Error(`Unsupported PNG bitDepth ${bitDepth} in ${filePath}`);
  }

  let topLeftPixelRGBA: [number, number, number, number];
  if (colorType === 6) {
    topLeftPixelRGBA = [rawPixel0[0], rawPixel0[1], rawPixel0[2], rawPixel0[3]];
  } else if (colorType === 2) {
    topLeftPixelRGBA = [rawPixel0[0], rawPixel0[1], rawPixel0[2], 255];
  } else if (colorType === 4) {
    topLeftPixelRGBA = [rawPixel0[0], rawPixel0[0], rawPixel0[0], rawPixel0[1]];
  } else if (colorType === 0) {
    topLeftPixelRGBA = [rawPixel0[0], rawPixel0[0], rawPixel0[0], 255];
  } else if (colorType === 3 && plte) {
    const idx = rawPixel0[0];
    const r = plte.readUInt8(idx * 3);
    const g = plte.readUInt8(idx * 3 + 1);
    const b = plte.readUInt8(idx * 3 + 2);
    const a = trns && idx < trns.length ? trns.readUInt8(idx) : 255;
    topLeftPixelRGBA = [r, g, b, a];
  } else {
    throw new Error(`Unsupported PNG colorType ${colorType} in ${filePath}`);
  }

  return { width, height, bitDepth, colorType, topLeftPixelRGBA };
}

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

export interface DistSubpathServer {
  origin: string;
  baseUrl: string;
  subpath: string;
  requests: Array<{ path: string; status: number }>;
  close: () => Promise<void>;
}

export async function startDistSubpathServer(
  subpath = '/LaserTrepanningCalculator/',
): Promise<DistSubpathServer> {
  const distRoot = assertDeliverableExists('dist', 'M1/M4');
  assertDeliverableExists('dist/index.html', 'M1/M4');

  const normalizedSubpath = subpath.endsWith('/') ? subpath : `${subpath}/`;
  const requests: Array<{ path: string; status: number }> = [];

  const server = http.createServer((req, res) => {
    const reqUrl = new URL(req.url ?? '/', 'http://127.0.0.1');
    let reqPath: string;
    try {
      reqPath = decodeURIComponent(reqUrl.pathname);
    } catch {
      requests.push({ path: reqUrl.pathname, status: 400 });
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Bad Request');
      return;
    }

    if (reqPath === normalizedSubpath.slice(0, -1)) {
      requests.push({ path: reqPath, status: 302 });
      res.writeHead(302, { Location: normalizedSubpath });
      res.end();
      return;
    }

    if (!reqPath.startsWith(normalizedSubpath)) {
      requests.push({ path: reqPath, status: 404 });
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found outside subpath');
      return;
    }

    let relPath = reqPath.slice(normalizedSubpath.length).replace(/^\/+/, '');
    if (!relPath || relPath.endsWith('/')) {
      relPath = `${relPath}index.html`;
    }

    const resolved = path.resolve(distRoot, relPath);
    if (resolved !== distRoot && !resolved.startsWith(distRoot + path.sep)) {
      requests.push({ path: reqPath, status: 403 });
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }

    if (!fs.existsSync(resolved) || fs.statSync(resolved).isDirectory()) {
      requests.push({ path: reqPath, status: 404 });
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(`Missing dist file: ${relPath}`);
      return;
    }

    const ext = path.extname(resolved).toLowerCase();
    const contentType = MIME_TYPES[ext] ?? 'application/octet-stream';
    const data = fs.readFileSync(resolved);
    requests.push({ path: reqPath, status: 200 });
    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-store',
    });
    res.end(data);
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const addr = server.address();
  if (!addr || typeof addr === 'string') {
    throw new Error('Failed to bind ephemeral port for dist subpath server');
  }
  const origin = `http://127.0.0.1:${addr.port}`;
  const baseUrl = `${origin}${normalizedSubpath}`;

  return {
    origin,
    baseUrl,
    subpath: normalizedSubpath,
    requests,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
