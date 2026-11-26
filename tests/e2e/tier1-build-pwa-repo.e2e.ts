import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  assertDeliverableExists,
  parsePngInfo,
  resolveWorkspacePath,
  startDistSubpathServer,
  walkFiles,
  WORKSPACE_ROOT,
} from './helpers/env.ts';

describe('Tier 1 & Tier 2 — F1 Build/Repo/CI & F2 PWA Artifacts', () => {
  it('T1-F1-01: package.json & tsconfig.json define expected build scripts and strict ESM compiler options', () => {
    const pkg = JSON.parse(fs.readFileSync(resolveWorkspacePath('package.json'), 'utf8')) as {
      type?: string;
      scripts?: Record<string, string>;
    };
    const tsconfig = JSON.parse(fs.readFileSync(resolveWorkspacePath('tsconfig.json'), 'utf8')) as {
      compilerOptions?: Record<string, unknown>;
    };

    expect(pkg.type).toBe('module');
    expect(pkg.scripts?.['build:wasm']).toContain('asc');
    expect(pkg.scripts?.['build:wasm']).toContain('--target release');
    expect(pkg.scripts?.['build:wasm']).toContain('--bindings raw');
    expect(pkg.scripts?.build).toContain('vite build');
    expect(pkg.scripts?.typecheck).toContain('tsc --noEmit');
    expect(pkg.scripts?.test).toContain('vitest');

    const opts = tsconfig.compilerOptions ?? {};
    expect(opts.strict).toBe(true);
    expect(opts.target).toBe('ESNext');
    expect(opts.module).toBe('ESNext');
    expect(opts.noEmit).toBe(true);
  });

  it('T1-F1-02: vite.config.ts and dist/index.html use relative ./ base and ESNext/ES worker targets', () => {
    const viteConfig = fs.readFileSync(resolveWorkspacePath('vite.config.ts'), 'utf8');
    expect(viteConfig).toMatch(/base:\s*['"]\.\/['"]/);
    expect(viteConfig).toMatch(/target:\s*['"]esnext['"]/);
    expect(viteConfig).toMatch(/format:\s*['"]es['"]/);

    const distIndexPath = assertDeliverableExists('dist/index.html', 'M1');
    const distHtml = fs.readFileSync(distIndexPath, 'utf8');
    expect(distHtml).toContain('./assets/');
    expect(distHtml).not.toMatch(/(?:href|src)=["']\/assets\//);
  });

  it('T1-F1-03: .github/workflows/deploy.yml configures static GitHub Pages build & deploy without CNAME', () => {
    const workflow = fs.readFileSync(
      assertDeliverableExists('.github/workflows/deploy.yml', 'M1'),
      'utf8',
    );
    expect(workflow).toContain('npm ci');
    expect(workflow).toContain('npm run build:wasm');
    expect(workflow).toContain('npm run typecheck');
    expect(workflow).toContain('npm test');
    expect(workflow).toContain('npm run build');
    expect(workflow).toContain('actions/configure-pages');
    expect(workflow).toContain('actions/upload-pages-artifact');
    expect(workflow).toMatch(/path:\s*\.\/dist/);
    expect(workflow).toContain('actions/deploy-pages');
    expect(workflow.toLowerCase()).not.toContain('cname');
  });

  it('T1-F1-04: .gitignore excludes dependencies, dist, wasm binary, xlsx workbooks, and temporary inspection dumps', () => {
    const gitignore = fs.readFileSync(assertDeliverableExists('.gitignore', 'M1'), 'utf8');
    const requiredEntries = [
      'node_modules/',
      'dist/',
      '.vite/',
      'src/wasm/engine.wasm',
      '*.xlsx',
      'inspect_*.py',
      'dump_specs.py',
      'test_math.py',
      'main_cells.txt',
      'defined_names.json',
      'sheet_*.json',
    ];
    for (const pattern of requiredEntries) {
      expect(gitignore, `.gitignore missing ${pattern}`).toContain(pattern);
    }
  });

  it('T1-F1-05: production build outputs in dist/ and TypeScript noEmit config are present and valid', () => {
    const pkg = JSON.parse(fs.readFileSync(resolveWorkspacePath('package.json'), 'utf8')) as {
      scripts?: Record<string, string>;
    };
    expect(pkg.scripts?.build).toBe('vite build');
    expect(pkg.scripts?.['build:wasm']).toContain('assembly/engine.ts');

    const distIndex = assertDeliverableExists('dist/index.html', 'M1');
    expect(fs.statSync(distIndex).size).toBeGreaterThan(0);

    const distFiles = walkFiles(resolveWorkspacePath('dist'));
    const jsBundles = distFiles.filter((f) => f.startsWith('assets/') && f.endsWith('.js'));
    expect(jsBundles.length).toBeGreaterThan(0);
  });

  it('T2-F1-01: production dist/ contains zero xlsx, inspection scripts, dump JSONs, or CNAME', () => {
    const distDir = assertDeliverableExists('dist', 'M1');
    const files = walkFiles(distDir);
    const forbiddenRegex =
      /(^|\/)(CNAME|.*\.xlsx|inspect_.*\.py|dump_specs\.py|test_math\.py|main_cells\.txt|defined_names\.json|sheet_.*\.json)$/i;
    const leaks = files.filter((f) => forbiddenRegex.test(f));
    expect(leaks, `Forbidden files leaked into dist/: ${leaks.join(', ')}`).toEqual([]);
  });

  it('T2-F1-02: zero SharedArrayBuffer or COOP/COEP header hacks exist in source, config, or dist', () => {
    const scanPaths = [
      resolveWorkspacePath('vite.config.ts'),
      resolveWorkspacePath('index.html'),
      ...walkFiles(resolveWorkspacePath('src')).map((f) => resolveWorkspacePath('src', f)),
      ...walkFiles(resolveWorkspacePath('dist'))
        .filter((f) => /\.(html|js|css)$/i.test(f))
        .map((f) => resolveWorkspacePath('dist', f)),
    ].filter((p) => fs.existsSync(p));

    const forbidden = /SharedArrayBuffer|Cross-Origin-Opener-Policy|Cross-Origin-Embedder-Policy/;
    for (const file of scanPaths) {
      const text = fs.readFileSync(file, 'utf8');
      expect(forbidden.test(text), `Forbidden SAB/COOP-COEP reference in ${file}`).toBe(false);
    }
  });

  it('T2-F1-03: non-root GitHub Pages subpath hosting serves index, manifest, SW, and assets with HTTP 200', async () => {
    const server = await startDistSubpathServer('/LaserTrepanningCalculator/');
    try {
      const indexRes = await fetch(server.baseUrl);
      expect(indexRes.status).toBe(200);
      const html = await indexRes.text();

      const manifestRes = await fetch(`${server.baseUrl}manifest.webmanifest`);
      expect(manifestRes.status).toBe(200);
      const manifest = (await manifestRes.json()) as {
        icons?: Array<{ src: string }>;
      };

      const rootAssetsLeak = await fetch(`${server.origin}/assets/index.js`);
      expect(rootAssetsLeak.status).toBe(404);

      const urlMatches = [...html.matchAll(/(?:src|href)=["'](\.\/[^"']+)["']/g)].map((m) => m[1]);
      expect(urlMatches.length).toBeGreaterThan(0);

      for (const rel of urlMatches) {
        const cleanRel = rel.replace(/^\.\//, '');
        if (cleanRel === 'style.css' && !fs.existsSync(resolveWorkspacePath('dist/style.css'))) {
          throw new Error('Waiting for M4: dist/index.html still references unbundled ./style.css');
        }
        const res = await fetch(`${server.baseUrl}${cleanRel}`);
        expect(res.status, `Subpath fetch failed for ${rel}`).toBe(200);
      }

      for (const icon of manifest.icons ?? []) {
        const res = await fetch(`${server.baseUrl}${icon.src.replace(/^\.\//, '')}`);
        expect(res.status, `Manifest icon fetch failed for ${icon.src}`).toBe(200);
      }
    } finally {
      await server.close();
    }
  });

  it('T2-F1-04: git repository excludes all xlsx, inspection dumps, and compiled wasm binary', () => {
    if (!fs.existsSync(resolveWorkspacePath('.git'))) {
      throw new Error('Expected .git directory in workspace root');
    }

    const lsFiles = spawnSync('git', ['ls-files'], {
      cwd: WORKSPACE_ROOT,
      encoding: 'utf8',
    });
    expect(lsFiles.status).toBe(0);
    const tracked = lsFiles.stdout.split(/\r?\n/).filter(Boolean);
    const trackedLeaks = tracked.filter((f) =>
      /(\.xlsx$|inspect_.*\.py$|dump_specs\.py$|test_math\.py$|main_cells\.txt$|defined_names\.json$|sheet_.*\.json$|src\/wasm\/engine\.wasm$)/i.test(
        f,
      ),
    );
    expect(trackedLeaks).toEqual([]);

    const checkIgnoreTargets = [
      'Ablation Calc with Trepanning v5.3 Release.xlsx',
      'inspect_wb.py',
      'dump_specs.py',
      'test_math.py',
      'main_cells.txt',
      'defined_names.json',
      'sheet_main.json',
      'src/wasm/engine.wasm',
    ];
    for (const target of checkIgnoreTargets) {
      const check = spawnSync('git', ['check-ignore', '-q', target], {
        cwd: WORKSPACE_ROOT,
      });
      expect(check.status, `git check-ignore failed for ${target}`).toBe(0);
    }
  });

  it('T2-F1-05: TypeScript strict typecheck (tsc --noEmit) passes with zero errors', () => {
    const tsconfig = JSON.parse(fs.readFileSync(resolveWorkspacePath('tsconfig.json'), 'utf8')) as {
      compilerOptions?: Record<string, unknown>;
    };
    const opts = tsconfig.compilerOptions ?? {};
    expect(opts.strict).toBe(true);
    expect(opts.noUnusedLocals).toBe(true);
    expect(opts.noUnusedParameters).toBe(true);
    expect(opts.noFallthroughCasesInSwitch).toBe(true);

    const tscCmd = path.join(WORKSPACE_ROOT, 'node_modules', '.bin', 'tsc.cmd');
    const result = spawnSync(tscCmd, ['--noEmit'], {
      cwd: WORKSPACE_ROOT,
      encoding: 'utf8',
      shell: true,
    });
    expect(
      result.status,
      `tsc --noEmit failed:\n${result.stdout}\n${result.stderr}`,
    ).toBe(0);
  });

  it('T1-F2-01: generated PWA PNG icons have valid magic headers and exact pixel dimensions in public/ and dist/', () => {
    const expectedSizes: Array<[string, number, number]> = [
      ['pwa-192x192.png', 192, 192],
      ['pwa-512x512.png', 512, 512],
      ['pwa-maskable-512x512.png', 512, 512],
      ['apple-touch-icon-180x180.png', 180, 180],
    ];

    for (const [filename, expW, expH] of expectedSizes) {
      const pubFile = assertDeliverableExists(`public/${filename}`, 'M1');
      const pubInfo = parsePngInfo(pubFile);
      expect(pubInfo.width, `public/${filename} width`).toBe(expW);
      expect(pubInfo.height, `public/${filename} height`).toBe(expH);

      const distFile = assertDeliverableExists(`dist/${filename}`, 'M1');
      const distInfo = parsePngInfo(distFile);
      expect(distInfo.width, `dist/${filename} width`).toBe(expW);
      expect(distInfo.height, `dist/${filename} height`).toBe(expH);
    }
  });

  it('T1-F2-02: dist/manifest.webmanifest enforces relative ./ scope/id/start_url, standalone display, and required icons', () => {
    const manifestPath = assertDeliverableExists('dist/manifest.webmanifest', 'M1');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as {
      id?: string;
      start_url?: string;
      scope?: string;
      display?: string;
      icons?: Array<{ src: string; sizes: string; purpose?: string }>;
    };

    expect(manifest.id).toBe('./');
    expect(manifest.start_url).toBe('./');
    expect(manifest.scope).toBe('./');
    expect(manifest.display).toBe('standalone');

    const icons = manifest.icons ?? [];
    expect(icons.some((i) => i.sizes === '192x192' && i.purpose === 'any')).toBe(true);
    expect(icons.some((i) => i.sizes === '512x512' && i.purpose === 'any')).toBe(true);
    expect(icons.some((i) => i.sizes === '512x512' && i.purpose === 'maskable')).toBe(true);
  });

  it('T1-F2-03: Workbox service worker & precache config cover html, js, css, wasm, svg, png, and webmanifest', () => {
    const swPath = assertDeliverableExists('dist/sw.js', 'M1');
    const swText = fs.readFileSync(swPath, 'utf8');
    const distFiles = walkFiles(resolveWorkspacePath('dist'));
    expect(distFiles.some((f) => /^workbox-.*\.js$/.test(f))).toBe(true);

    expect(swText).toContain('precacheAndRoute');
    expect(swText).toContain('index.html');
    expect(swText).toContain('manifest.webmanifest');
    expect(swText).toContain('.js');
    expect(swText).toContain('.svg');
    expect(swText).toContain('.png');

    const viteConfig = fs.readFileSync(resolveWorkspacePath('vite.config.ts'), 'utf8');
    expect(viteConfig).toContain('**/*.{js,css,html,wasm,svg,png,webmanifest}');
  });

  it('T1-F2-04: Workbox uses registerType prompt rather than unconditional skipWaiting', () => {
    const viteConfig = fs.readFileSync(resolveWorkspacePath('vite.config.ts'), 'utf8');
    expect(viteConfig).toMatch(/registerType:\s*['"]prompt['"]/);

    const swText = fs.readFileSync(assertDeliverableExists('dist/sw.js', 'M1'), 'utf8');
    expect(swText).toContain('SKIP_WAITING');
    expect(swText).toContain('message');
  });

  it('T1-F2-05: dist/index.html links favicon and apple-touch-icon relatively with zero ./public/ prefixes', () => {
    const distHtml = fs.readFileSync(assertDeliverableExists('dist/index.html', 'M1'), 'utf8');
    expect(distHtml).not.toContain('./public/');
    expect(distHtml).toMatch(/<link[^>]+rel=["']icon["'][^>]+href=["']\.\/[^"']*favicon[^"']*\.svg["']/i);
    if (!distHtml.includes('apple-touch-icon')) {
      throw new Error('Waiting for M4: dist/index.html missing <link rel="apple-touch-icon" href="./apple-touch-icon-180x180.png">');
    }
    expect(distHtml).toMatch(/apple-touch-icon-180x180\.png/);
  });

  it('T2-F2-01: pwa-maskable-512x512.png has full-bleed opaque corner pixel (alpha === 255)', () => {
    const info = parsePngInfo(assertDeliverableExists('public/pwa-maskable-512x512.png', 'M1'));
    expect(info.width).toBe(512);
    expect(info.height).toBe(512);
    expect(info.topLeftPixelRGBA[3]).toBe(255);
  });

  it('T2-F2-03: dist/sw.js precache manifest includes compiled .wasm asset for offline physics', () => {
    const swText = fs.readFileSync(assertDeliverableExists('dist/sw.js', 'M1'), 'utf8');
    if (!/\.wasm["']/.test(swText)) {
      throw new Error('Waiting for M2/M4: compiled .wasm not yet precached in dist/sw.js');
    }
    expect(swText).toMatch(/\.wasm["']/);
  });
});
