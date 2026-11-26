import fs from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { withCdpPage } from './helpers/cdp.ts';
import {
  cloneDefaultInput,
  closeViteSsrServer,
  findLaserByName,
  findScanheadByName,
  loadPresetsContract,
  loadTsEngineContract,
  loadWasmRunnerContract,
  startViteWorkerHarnessServer,
} from './helpers/contracts.ts';
import {
  assertDeliverableExists,
  expectClose,
  GOLDEN_DEFAULT,
  resolveWorkspacePath,
  walkFiles,
} from './helpers/env.ts';

afterAll(async () => {
  await closeViteSsrServer();
});

describe('Tier 1 & Tier 2 — F3 Presets & F4 Optics', () => {
  it('T1-F3-01: all GF vendor references are replaced with Charmilles in presets and TS sources', async () => {
    const presets = await loadPresetsContract();
    const names = [
      ...presets.LASER_PRESETS.map((l) => l.name),
      ...presets.SCANHEAD_PRESETS.map((s) => s.name),
    ];
    expect(names.some((n) => n === 'Charmilles Femto FlexiPulse IR')).toBe(true);
    expect(names.some((n) => n === 'Charmilles Femto FlexiPulse Green')).toBe(true);
    for (const name of names) {
      expect(/\bGF\b/i.test(name), `Unexpected GF in preset name: ${name}`).toBe(false);
    }

    const tsFiles = walkFiles(resolveWorkspacePath('src'))
      .filter((f) => f.endsWith('.ts'))
      .map((f) => `src/${f}`);
    const asmFiles = walkFiles(resolveWorkspacePath('assembly'))
      .filter((f) => f.endsWith('.ts'))
      .map((f) => `assembly/${f}`);
    const scanTargets = [...tsFiles, ...asmFiles, 'index.html'];

    for (const rel of scanTargets) {
      const raw = fs.readFileSync(resolveWorkspacePath(rel), 'utf8');
      const content = rel.endsWith('.html')
        ? raw.replace(/<!--[\s\S]*?-->/g, '')
        : raw.replace(/\/\*[\s\S]*?\*\/|(?:^|\s)\/\/.*$/gm, '');
      expect(/\bGF\b/.test(content), `Unexpected GF token in ${rel}`).toBe(false);
    }
  });

  it('T1-F3-02: LASER_PRESETS exposes all 6 required lasers with exact FWHM, wavelength, and color', async () => {
    const presets = await loadPresetsContract();
    expect(presets.LASER_PRESETS.length).toBe(6);

    const expected: Array<[string, number, number, 'IR' | 'Green']> = [
      ['Charmilles Femto FlexiPulse IR', 250, 1.035, 'IR'],
      ['Charmilles Femto FlexiPulse Green', 250, 0.515, 'Green'],
      ['Light Conversion Carbide IR', 250, 1.035, 'IR'],
      ['Light Conversion Carbide Green', 250, 0.515, 'Green'],
      ['Coherent Monaco', 270, 1.035, 'IR'],
      ['Manual Input', 500, 0.515, 'Green'],
    ];

    for (const [name, fwhm, wl, color] of expected) {
      const found = presets.LASER_PRESETS.find((l) => l.name === name);
      expect(found, `Missing laser preset ${name}`).toBeDefined();
      expect(found!.pulseWidth_fs).toBe(fwhm);
      expectClose(found!.wavelength_um, wl, 1e-12, `${name} wavelength`);
      expect(found!.color).toBe(color);
    }
  });

  it('T1-F3-03: SCANHEAD_PRESETS exposes all 4 required scanheads with exact optical/kinematic specs', async () => {
    const presets = await loadPresetsContract();
    expect(presets.SCANHEAD_PRESETS.length).toBe(4);

    const arges = findScanheadByName(presets, 'Arges Elephant v2 IR');
    expect(arges.brand).toBe('Arges');
    expect(arges.color).toBe('IR');
    expect(arges.focalLength_mm).toBe(60);
    expect(arges.beamDiameter_mm).toBe(9);
    expect(arges.transmission_pct).toBe(85);
    expect(arges.scanSpeed_Hz).toBe(500);
    expect(arges.mSquared).toBe(1.2);
    expect(arges.maxAttackAngle_deg).toBe(10);
    expect(arges.maxZTranslation_um).toBe(1050);

    const slir = findScanheadByName(presets, 'Scanlab PrecSYS IR');
    expect(slir.brand).toBe('Scanlab');
    expect(slir.color).toBe('IR');
    expect(slir.focalLength_mm).toBe(75);
    expect(slir.beamDiameter_mm).toBe(7);
    expect(slir.transmission_pct).toBe(90);
    expect(slir.scanSpeed_Hz).toBe(500);
    expect(slir.mSquared).toBe(1.1);
    expect(slir.maxAttackAngle_deg).toBe(7.5);
    expect(slir.maxZTranslation_um).toBe(1000);

    const slgr = findScanheadByName(presets, 'Scanlab PrecSYS Green');
    expect(slgr.brand).toBe('Scanlab');
    expect(slgr.color).toBe('Green');
    expect(slgr.focalLength_mm).toBe(75);
    expect(slgr.beamDiameter_mm).toBe(7);
    expect(slgr.transmission_pct).toBe(90);
    expect(slgr.mSquared).toBe(1.1);

    const manual = findScanheadByName(presets, 'Manual Input');
    expect(manual.mSquared).toBe(1.05);
    expect(manual.focalLength_mm).toBe(75);
    expect(manual.beamDiameter_mm).toBe(7);
    expect(manual.transmission_pct).toBe(90);
    expect(manual.scanSpeed_Hz).toBe(500);
    expect(manual.maxAttackAngle_deg).toBe(7.5);
    expect(manual.maxZTranslation_um).toBe(1000);
  });

  it('T1-F3-04: Manual Input laser and scanhead overrides flow into optics and brand kinematics', async () => {
    const presets = await loadPresetsContract();
    const compute = await loadTsEngineContract();
    const input = cloneDefaultInput(presets);
    const manualLaser = findLaserByName(presets, 'Manual Input');
    const manualHead = findScanheadByName(presets, 'Manual Input');

    input.laserId = manualLaser.id;
    input.scanheadId = manualHead.id;
    input.pulseWidthOverride_fs = null;
    input.manualLaserWavelength_um = 0.355;
    input.manualLaserColor = 'Green';
    input.manualLaserPulseWidth_fs = 300;
    input.manualScanheadBrand = 'Arges';
    input.manualScanheadColor = 'Green';
    input.manualScanheadFocalLength_mm = 50;
    input.manualScanheadBeamDia_mm = 8;
    input.manualScanheadTransmission_pct = 88;
    input.manualScanheadM2 = 1.15;
    input.manualScanheadMaxAttack_deg = 12;
    input.manualScanheadMaxZTravel_um = 1200;

    const out = compute(input);
    const expectedSpot = ((4 * 0.355 * 1.15) / Math.PI) * (50 / 8);
    expectClose(out.scalars.spotSize_um, expectedSpot, 1e-6, 'manual spot size');
    expect(out.scalars.wavelengthMismatch).toBe(false);
    expectClose(out.scalars.pulseEnergyOutput_uJ, 200 * 0.88, 1e-6, 'manual pulse energy');
    expectClose(out.scalars.effectiveScanRadius_um, 350, 1e-6, 'Arges radius=ScanDia');
  });

  it('T1-F3-05: Round Hole vs Square Hole updates Scan_r and AOI_Square_Scaling for Scanlab', async () => {
    const presets = await loadPresetsContract();
    const compute = await loadTsEngineContract();

    const roundIn = cloneDefaultInput(presets);
    roundIn.holeType = 'round';
    const roundOut = compute(roundIn);
    expectClose(roundOut.scalars.effectiveScanRadius_um, 175, 1e-6, 'round Scan_r');
    expectClose(roundOut.scalars.aoiSquareScaling, 1, 1e-6, 'round AOI scaling');

    const sqIn = cloneDefaultInput(presets);
    sqIn.holeType = 'square';
    const sqOut = compute(sqIn);
    expectClose(sqOut.scalars.effectiveScanRadius_um, 350, 1e-6, 'square Scan_r');
    expectClose(sqOut.scalars.aoiSquareScaling, 1 / Math.SQRT2, 1e-6, 'square AOI scaling');
    expectClose(sqOut.scalars.attackPct, -sqIn.endAOI / Math.SQRT2, 1e-6, 'square attackPct');
  });

  it('T2-F3-01: unknown/corrupt preset IDs fall back safely without throwing or NaN', async () => {
    const presets = await loadPresetsContract();
    const compute = await loadTsEngineContract();
    const input = cloneDefaultInput(presets);
    input.laserId = 'GF Femto';
    input.scanheadId = 'UNKNOWN_SCANHEAD';

    const out = compute(input);
    expect(Number.isFinite(out.scalars.spotSize_um)).toBe(true);
    expect(Number.isFinite(out.scalars.peakFluence_J_cm2)).toBe(true);
    expect(out.scalars.spotSize_um).toBeGreaterThan(0);
  });

  it('T2-F3-02: Manual Laser IR vs Green switching toggles wavelengthMismatch against PrecSYS Green', async () => {
    const presets = await loadPresetsContract();
    const compute = await loadTsEngineContract();
    const manualLaser = findLaserByName(presets, 'Manual Input');
    const slgr = findScanheadByName(presets, 'Scanlab PrecSYS Green');

    const greenIn = cloneDefaultInput(presets);
    greenIn.laserId = manualLaser.id;
    greenIn.scanheadId = slgr.id;
    greenIn.manualLaserWavelength_um = 0.515;
    greenIn.manualLaserColor = 'Green';
    expect(compute(greenIn).scalars.wavelengthMismatch).toBe(false);

    const irIn = cloneDefaultInput(presets);
    irIn.laserId = manualLaser.id;
    irIn.scanheadId = slgr.id;
    irIn.manualLaserWavelength_um = 1.035;
    irIn.manualLaserColor = 'IR';
    expect(compute(irIn).scalars.wavelengthMismatch).toBe(true);
  });

  it('T2-F3-03: Manual Scanhead brand switch toggles Scanlab square scaling vs Arges square warning', async () => {
    const presets = await loadPresetsContract();
    const compute = await loadTsEngineContract();
    const manualHead = findScanheadByName(presets, 'Manual Input');

    const scanlabIn = cloneDefaultInput(presets);
    scanlabIn.scanheadId = manualHead.id;
    scanlabIn.holeType = 'square';
    scanlabIn.manualScanheadBrand = 'Scanlab';
    const scanlabOut = compute(scanlabIn);
    expect(scanlabOut.scalars.argesSquareWarning).toBe(false);
    expectClose(scanlabOut.scalars.aoiSquareScaling, 1 / Math.SQRT2, 1e-6);

    const argesIn = cloneDefaultInput(presets);
    argesIn.scanheadId = manualHead.id;
    argesIn.holeType = 'square';
    argesIn.manualScanheadBrand = 'Arges';
    const argesOut = compute(argesIn);
    expect(argesOut.scalars.argesSquareWarning).toBe(true);
    expectClose(argesOut.scalars.aoiSquareScaling, 1, 1e-6);
  });

  it('T2-F3-04: nullable overrides distinguish null (preset fallback) from explicit 0', async () => {
    const presets = await loadPresetsContract();
    const compute = await loadTsEngineContract();
    const carbide = findLaserByName(presets, 'Carbide IR');

    const nullIn = cloneDefaultInput(presets);
    nullIn.laserId = carbide.id;
    nullIn.pulseWidthOverride_fs = null;
    nullIn.focusRelZ_um = null;
    const nullOut = compute(nullIn);
    expectClose(nullOut.scalars.pulseWidth_fs, 250, 1e-9, 'preset fallback pulseWidth');
    expectClose(nullOut.scalars.focusRelZ_um, 0, 1e-9, 'null focusRelZ -> 0');

    const explicitIn = cloneDefaultInput(presets);
    explicitIn.pulseWidthOverride_fs = 500;
    explicitIn.focusRelZ_um = 0;
    const explicitOut = compute(explicitIn);
    expectClose(explicitOut.scalars.pulseWidth_fs, 500, 1e-9, 'explicit 500fs override');
    expectClose(explicitOut.scalars.focusRelZ_um, 0, 1e-9, 'explicit 0 focusRelZ');
  });

  it('T2-F3-05: zero GF vendor strings exist in preset IDs, labels, or Excel codes', async () => {
    const presets = await loadPresetsContract();
    const serialized = JSON.stringify({
      lasers: presets.LASER_PRESETS,
      scanheads: presets.SCANHEAD_PRESETS,
      holes: presets.HOLE_TYPES,
    });
    expect(/\bGF\b/i.test(serialized)).toBe(false);
  });

  it('T1-F4-01: Scanlab round-hole radius fix produces exact golden scanSpeed and spotOverlap', async () => {
    const presets = await loadPresetsContract();
    const compute = await loadTsEngineContract();
    const out = compute(cloneDefaultInput(presets));

    expectClose(out.scalars.effectiveScanRadius_um, 175, 1e-9, 'Scan_r');
    expectClose(out.scalars.scanSpeed_mm_s, GOLDEN_DEFAULT.scanSpeed_mm_s, 1e-5, 'scanSpeed');
    expectClose(out.scalars.spotOverlap_pct, GOLDEN_DEFAULT.spotOverlap_pct, 1e-4, 'spotOverlap');
  });

  it('T1-F4-02: XY scaling (jobScaling * nodeScaling) scales radius, scanSpeed, and spotOverlap', async () => {
    const presets = await loadPresetsContract();
    const compute = await loadTsEngineContract();
    const input = cloneDefaultInput(presets);
    input.jobScaling = 1.5;
    input.nodeScaling = 0.8; // total = 1.2

    const out = compute(input);
    const expectedSpeed = GOLDEN_DEFAULT.scanSpeed_mm_s * 1.2;
    const expectedOverlap =
      (1 - ((expectedSpeed / 50_000) * 1000) / GOLDEN_DEFAULT.spotSize_um) * 100;

    expectClose(out.scalars.effectiveScanRadius_um, 175 * 1.2, 1e-6, 'scaled Scan_r');
    expectClose(out.scalars.scanSpeed_mm_s, expectedSpeed, 1e-5, 'scaled scanSpeed');
    expectClose(out.scalars.spotOverlap_pct, expectedOverlap, 1e-4, 'scaled spotOverlap');
  });

  it('T1-F4-03: Beam Divergence defaults to Current (Accurate) and switches 10x to Legacy', async () => {
    const presets = await loadPresetsContract();
    const compute = await loadTsEngineContract();

    const currIn = cloneDefaultInput(presets);
    expect(currIn.divergenceMode).toBe('current');
    const currOut = compute(currIn);
    expectClose(currOut.scalars.beamDivergence_mrad, 42.42424242424241, 1e-5, 'current divergence');

    const legIn = cloneDefaultInput(presets);
    legIn.divergenceMode = 'legacy';
    const legOut = compute(legIn);
    expectClose(legOut.scalars.beamDivergence_mrad, 4.242424242424241, 1e-5, 'legacy divergence');
  });

  it('T1-F4-04: Z From Focus lookup returns exact ablated spot diameter at Z=0 and Z=zR', async () => {
    const presets = await loadPresetsContract();
    const compute = await loadTsEngineContract();

    const at0 = cloneDefaultInput(presets);
    at0.zFromFocusLookup_um = 0;
    expectClose(
      compute(at0).scalars.ablatedSpotAtLookupZ_um,
      GOLDEN_DEFAULT.ablatedSpotAt0_um,
      1e-5,
      'ablatedSpot@0',
    );

    const atZr = cloneDefaultInput(presets);
    atZr.zFromFocusLookup_um = GOLDEN_DEFAULT.rayleighRange_um;
    const w0 = GOLDEN_DEFAULT.spotSize_um / 2;
    const wZr = w0 * Math.SQRT2;
    const expectedAtZr =
      2 * Math.sqrt(((wZr * wZr) / 2) * Math.log((GOLDEN_DEFAULT.peakFluence_J_cm2 * (w0 / wZr) ** 2) / 2));
    expectClose(
      compute(atZr).scalars.ablatedSpotAtLookupZ_um,
      expectedAtZr,
      5e-3,
      'ablatedSpot@zR',
    );
  });

  it('T1-F4-05: wavelength mismatch and Arges+Square warnings emit non-blocking boolean flags', async () => {
    const presets = await loadPresetsContract();
    const compute = await loadTsEngineContract();

    const mismatchIn = cloneDefaultInput(presets);
    mismatchIn.laserId = findLaserByName(presets, 'Carbide IR').id;
    mismatchIn.scanheadId = findScanheadByName(presets, 'Scanlab PrecSYS Green').id;
    const mismatchOut = compute(mismatchIn);
    expect(mismatchOut.scalars.wavelengthMismatch).toBe(true);
    expect(Number.isFinite(mismatchOut.scalars.peakFluence_J_cm2)).toBe(true);

    const argesSqIn = cloneDefaultInput(presets);
    argesSqIn.scanheadId = findScanheadByName(presets, 'Arges Elephant v2 IR').id;
    argesSqIn.holeType = 'square';
    const argesSqOut = compute(argesSqIn);
    expect(argesSqOut.scalars.argesSquareWarning).toBe(true);
    expect(Number.isFinite(argesSqOut.scalars.scanSpeed_mm_s)).toBe(true);
  });

  it('T1-F4-06: Single State ignores Start values while Transition interpolates linearly by progress', async () => {
    const presets = await loadPresetsContract();
    const compute = await loadTsEngineContract();

    const singleIn = cloneDefaultInput(presets);
    singleIn.stateMode = 'single';
    singleIn.transitionProgress_pct = 25;
    singleIn.startDia_um = 200;
    singleIn.startAOI = -4;
    singleIn.startZ = -500;
    singleIn.endDia_um = 350;
    singleIn.endAOI = -7;
    singleIn.endZ = -1100;
    const singleOut = compute(singleIn);
    expectClose(singleOut.scalars.activeScanDia_um, 350, 1e-9);
    expectClose(singleOut.scalars.activeAOI, -7, 1e-9);
    expectClose(singleOut.scalars.activeZ, -1100, 1e-9);

    const transIn = { ...singleIn, stateMode: 'transition' as const };
    const transOut = compute(transIn);
    expectClose(transOut.scalars.activeScanDia_um, 237.5, 1e-9);
    expectClose(transOut.scalars.activeAOI, -4.75, 1e-9);
    expectClose(transOut.scalars.activeZ, -650, 1e-9);
  });

  it('T2-F4-01: zero/degenerate process inputs are guarded without crashing or uncaught Infinity', async () => {
    const presets = await loadPresetsContract();
    const compute = await loadTsEngineContract();

    const zeroCases: Array<(i: ReturnType<typeof cloneDefaultInput>) => void> = [
      (i) => {
        i.baseRepRate_kHz = 0;
      },
      (i) => {
        i.divider = 0;
      },
      (i) => {
        i.pulseWidthOverride_fs = 0;
      },
      (i) => {
        i.beamDiaOverride_mm = 0;
      },
    ];

    for (const mutate of zeroCases) {
      const input = cloneDefaultInput(presets);
      mutate(input);
      const out = compute(input);
      expect(out.scalars).toBeDefined();
      expect(Number.isFinite(out.scalars.pulseEnergyOutput_uJ)).toBe(true);
      expect(Number.isFinite(out.scalars.spotSize_um)).toBe(true);
      expect(Number.isFinite(out.scalars.peakFluence_J_cm2)).toBe(true);
      expect(Number.isFinite(out.scalars.avgPower_W)).toBe(true);
      expect(Number.isFinite(out.scalars.scanSpeed_mm_s)).toBe(true);
    }
  });

  it('T2-F4-02: below-threshold fluence (F_th >= F_0) zeros thresholdR, energyAboveThresh, and ablatedSpotAt0', async () => {
    const presets = await loadPresetsContract();
    const compute = await loadTsEngineContract();
    const input = cloneDefaultInput(presets);
    input.ablationThreshOverride_J_cm2 = 250;

    const out = compute(input);
    expect(out.scalars.thresholdR).toBe(0);
    expect(out.scalars.energyAboveThresh_pct).toBe(0);
    expect(out.scalars.ablatedSpotAt0_um).toBe(0);
  });

  it('T2-F4-03: ultra-high fluence clamps thresholdR strictly to 5.0 via exp(-50) guard', async () => {
    const presets = await loadPresetsContract();
    const compute = await loadTsEngineContract();
    const input = cloneDefaultInput(presets);
    input.ablationThreshOverride_J_cm2 = 1e-22;

    const out = compute(input);
    expectClose(out.scalars.thresholdR, 5.0, 1e-12, 'thresholdR clamp');
    expect(out.scalars.energyAboveThresh_pct).toBeGreaterThan(99.99);
  });

  it('T2-F4-04: Z From Focus handles negative Z, exact Z=0, z_max, and > z_max cleanly', async () => {
    const presets = await loadPresetsContract();
    const compute = await loadTsEngineContract();

    const negIn = cloneDefaultInput(presets);
    negIn.zFromFocusLookup_um = -10;
    const negVal = compute(negIn).scalars.ablatedSpotAtLookupZ_um;
    expect(negVal === 0 || Number.isNaN(negVal)).toBe(true);

    const z0In = cloneDefaultInput(presets);
    z0In.zFromFocusLookup_um = 0;
    expectClose(
      compute(z0In).scalars.ablatedSpotAtLookupZ_um,
      GOLDEN_DEFAULT.ablatedSpotAt0_um,
      1e-5,
    );

    const zMaxIn = cloneDefaultInput(presets);
    zMaxIn.zFromFocusLookup_um = 3498;
    const zMaxVal = compute(zMaxIn).scalars.ablatedSpotAtLookupZ_um;
    expect(zMaxVal === 0 || Number.isNaN(zMaxVal)).toBe(true);

    const overIn = cloneDefaultInput(presets);
    overIn.zFromFocusLookup_um = 5000;
    const overVal = compute(overIn).scalars.ablatedSpotAtLookupZ_um;
    expect(overVal === 0 || Number.isNaN(overVal)).toBe(true);
  });

  it('T2-F4-05: transitionProgress_pct clamps out-of-range -10% and 150% and computes exact 50% midpoint', async () => {
    const presets = await loadPresetsContract();
    const compute = await loadTsEngineContract();

    const makeTrans = (pct: number) => {
      const i = cloneDefaultInput(presets);
      i.stateMode = 'transition';
      i.startDia_um = 100;
      i.startAOI = -2;
      i.startZ = -400;
      i.endDia_um = 300;
      i.endAOI = -6;
      i.endZ = -1000;
      i.transitionProgress_pct = pct;
      return compute(i);
    };

    const low = makeTrans(-10);
    const p0 = makeTrans(0);
    const p50 = makeTrans(50);
    const p100 = makeTrans(100);
    const high = makeTrans(150);

    expectClose(low.scalars.activeScanDia_um, p0.scalars.activeScanDia_um, 1e-9);
    expectClose(high.scalars.activeScanDia_um, p100.scalars.activeScanDia_um, 1e-9);
    expectClose(p50.scalars.activeScanDia_um, 200, 1e-9);
    expectClose(p50.scalars.activeAOI, -4, 1e-9);
    expectClose(p50.scalars.activeZ, -700, 1e-9);
  });

  it('T2-F4-06: divergenceMode toggle changes beamDivergence_mrad 10x without altering any other metric', async () => {
    const presets = await loadPresetsContract();
    const compute = await loadTsEngineContract();

    const a = cloneDefaultInput(presets);
    a.divergenceMode = 'current';
    const b = cloneDefaultInput(presets);
    b.divergenceMode = 'legacy';

    const outA = compute(a);
    const outB = compute(b);
    expectClose(outA.scalars.beamDivergence_mrad / outB.scalars.beamDivergence_mrad, 10, 1e-9);
    expect(outA.scalars.spotSize_um).toBe(outB.scalars.spotSize_um);
    expect(outA.scalars.rayleighRange_um).toBe(outB.scalars.rayleighRange_um);
    expect(outA.scalars.peakFluence_J_cm2).toBe(outB.scalars.peakFluence_J_cm2);
    expect(outA.scalars.nozzleClipping).toBe(outB.scalars.nozzleClipping);
  });
});

describe('Tier 1 & Tier 2 — F5 Distributions/Isofluence & F6 Trepanning', () => {
  it('T1-F5-01: 601-point focusDist grid covers r/w0 in [-3, +3] step 0.01 with exact Gaussian', async () => {
    const presets = await loadPresetsContract();
    const compute = await loadTsEngineContract();
    const out = compute(cloneDefaultInput(presets));

    expect(out.focusDist.length).toBe(601 * 5);
    expectClose(out.focusDist[1], -3.0, 1e-12, 'rNorm[0]');
    expectClose(out.focusDist[300 * 5 + 1], 0.0, 1e-12, 'rNorm[300]');
    expectClose(out.focusDist[600 * 5 + 1], 3.0, 1e-12, 'rNorm[600]');
    expectClose(out.focusDist[300 * 5 + 2], 1.0, 1e-12, 'gaussian[300]');
    expectClose(out.focusDist[2], Math.exp(-18), 1e-12, 'gaussian[0]');
    const w0 = out.scalars.w0_um;
    expectClose(out.focusDist[0], -3 * w0, 1e-9, 'r_um[0]');
  });

  it('T1-F5-02: focusDist partitions Gaussian cleanly into No-Ablation and Ablation around thresholdRatio', async () => {
    const presets = await loadPresetsContract();
    const compute = await loadTsEngineContract();
    const out = compute(cloneDefaultInput(presets));
    const ratio = out.scalars.thresholdRatio;

    expectClose(ratio, 2 / GOLDEN_DEFAULT.peakFluence_J_cm2, 1e-6, 'thresholdRatio');
    for (let i = 0; i < 601; i++) {
      const base = i * 5;
      const g = out.focusDist[base + 2];
      const noAbl = out.focusDist[base + 3];
      const abl = out.focusDist[base + 4];
      expectClose(noAbl + abl, g, 1e-12, `sum at i=${i}`);
      if (g > ratio) {
        expect(noAbl).toBe(0);
        expect(abl).toBe(g);
      } else {
        expect(noAbl).toBe(g);
        expect(abl).toBe(0);
      }
    }
  });

  it('T1-F5-03: 1,001-point isofluence grid spans [0, z_max] with default z_max = 3498 um', async () => {
    const presets = await loadPresetsContract();
    const compute = await loadTsEngineContract();
    const out = compute(cloneDefaultInput(presets));

    expect(out.isofluence.length).toBe(1001 * 22);
    expectClose(out.scalars.zMaxIsofluence_um, 3498, 1e-9, 'zMaxIsofluence_um');
    expectClose(out.isofluence[0], 0, 1e-12, 'z[0]');
    expectClose(out.isofluence[22], 3.498, 1e-9, 'z[1]');
    expectClose(out.isofluence[1000 * 22], 3498, 1e-9, 'z[1000]');
  });

  it('T1-F5-04: isofluence negative columns are exact negations of positive columns', async () => {
    const presets = await loadPresetsContract();
    const compute = await loadTsEngineContract();
    const out = compute(cloneDefaultInput(presets));

    const w0 = out.scalars.w0_um;
    expectClose(out.isofluence[1], w0, 1e-6, 'w(0)');
    expectClose(out.isofluence[2], w0 * Math.sqrt(0.5 * Math.log(1 / 0.135)), 1e-6, 'r_0.135(0)');

    for (const row of [0, 43]) {
      const base = row * 22;
      for (let col = 1; col <= 10; col++) {
        const pos = out.isofluence[base + col];
        const neg = out.isofluence[base + 11 + col];
        if (Number.isNaN(pos)) {
          expect(Number.isNaN(neg)).toBe(true);
        } else {
          expect(neg).toBe(-pos);
        }
      }
    }
  });

  it('T1-F5-05: isofluence Ablation (I) and Thermal Damage (I/64) match exact analytical radii at z=0', async () => {
    const presets = await loadPresetsContract();
    const compute = await loadTsEngineContract();
    const out = compute(cloneDefaultInput(presets));

    const ablRadius0 = out.isofluence[9]; // L2
    const thermRadius0 = out.isofluence[10]; // M2
    const w0 = out.scalars.w0_um;
    const expectedTherm = Math.sqrt(((w0 * w0) / 2) * Math.log(out.scalars.peakFluence_J_cm2 / (2 / 64)));

    expectClose(2 * ablRadius0, GOLDEN_DEFAULT.ablatedSpotAt0_um, 1e-5, '2*r_abl(0)');
    expectClose(thermRadius0, expectedTherm, 1e-5, 'r_td(0)');
    expect(thermRadius0).toBeGreaterThan(ablRadius0);
  });

  it('T2-F5-01: focusDist exact boundary endpoints r/w0 = -3.00 and +3.00 match exp(-18)', async () => {
    const presets = await loadPresetsContract();
    const compute = await loadTsEngineContract();
    const out = compute(cloneDefaultInput(presets));

    expect(out.focusDist[1]).toBe(-3);
    expect(out.focusDist[600 * 5 + 1]).toBe(3);
    expectClose(out.focusDist[2], Math.exp(-18), 1e-12);
    expectClose(out.focusDist[600 * 5 + 2], Math.exp(-18), 1e-12);
  });

  it('T2-F5-02: focusDist sets ablation=0 and noAblation=gaussian everywhere when F_th >= F_0', async () => {
    const presets = await loadPresetsContract();
    const compute = await loadTsEngineContract();
    const input = cloneDefaultInput(presets);
    input.ablationThreshOverride_J_cm2 = 300;
    const out = compute(input);

    for (let i = 0; i < 601; i++) {
      const base = i * 5;
      expect(out.focusDist[base + 4]).toBe(0);
      expect(out.focusDist[base + 3]).toBe(out.focusDist[base + 2]);
    }
  });

  it('T2-F5-03: isofluence 0.9*I0 contour transitions from finite to NaN past z_cutoff', async () => {
    const presets = await loadPresetsContract();
    const compute = await loadTsEngineContract();
    const out = compute(cloneDefaultInput(presets));

    expect(Number.isFinite(out.isofluence[8])).toBe(true); // row 0, col K (0.9*I0)
    expect(Number.isNaN(out.isofluence[15 * 22 + 8])).toBe(true); // z[15] = 52.47 > 50.426
    expect(Number.isNaN(out.isofluence[15 * 22 + 19])).toBe(true); // -0.9*I0
  });

  it('T2-F5-04: isofluence z_max formula handles zero thickness and negative focus_rel_z', async () => {
    const presets = await loadPresetsContract();
    const compute = await loadTsEngineContract();
    const input = cloneDefaultInput(presets);
    input.materialThick_um = 0;
    input.partSurface_Z_um = 100;
    input.focusRelZ_um = -200;
    input.endZ = -300; // Scanlab: z_shift = +300

    const out = compute(input);
    expectClose(out.scalars.zMaxIsofluence_um, 630, 1e-9, 'z_max=630');
  });

  it('T2-F5-05: isofluence Thermal Damage I/64 persists to z_max=3498 after Ablation I cuts off', async () => {
    const presets = await loadPresetsContract();
    const compute = await loadTsEngineContract();
    const out = compute(cloneDefaultInput(presets));

    // At z[500] (~1749 um > 1463 um), Ablation I is NaN while I/64 is still finite
    expect(Number.isNaN(out.isofluence[500 * 22 + 9])).toBe(true);
    expect(Number.isFinite(out.isofluence[500 * 22 + 10])).toBe(true);
    expect(Number.isFinite(out.isofluence[1000 * 22 + 10])).toBe(true);
  });

  it('T2-F5-06: isofluence handles degenerate z_max = 0 without division-by-zero or NaN w(0)', async () => {
    const presets = await loadPresetsContract();
    const compute = await loadTsEngineContract();
    const input = cloneDefaultInput(presets);
    input.materialThick_um = 0;
    input.partSurface_Z_um = 0;
    input.focusRelZ_um = 0;
    input.endZ = 0;

    const out = compute(input);
    expect(out.scalars.zMaxIsofluence_um).toBe(0);
    expect(out.isofluence[0]).toBe(0);
    expect(out.isofluence[1000 * 22]).toBe(0);
    expectClose(out.isofluence[1], out.scalars.w0_um, 1e-9);
    expectClose(out.isofluence[12], -out.scalars.w0_um, 1e-9);
  });

  it('T1-F6-01: 2,003-step orbit angle theta advances +2pi for CCW and -2pi for CW', async () => {
    const presets = await loadPresetsContract();
    const compute = await loadTsEngineContract();

    const ccwIn = cloneDefaultInput(presets);
    ccwIn.direction = 'CCW';
    const ccw = compute(ccwIn);
    expect(ccw.trepanningPath.theta.length).toBe(2003);
    expect(ccw.trepanningPath.theta[0]).toBe(0);
    expectClose(ccw.trepanningPath.theta[2000], 2 * Math.PI, 1e-9);
    expectClose(ccw.trepanningPath.theta[2002], 2.002 * Math.PI, 1e-9);

    const cwIn = cloneDefaultInput(presets);
    cwIn.direction = 'CW';
    const cw = compute(cwIn);
    expectClose(cw.trepanningPath.theta[2000], -2 * Math.PI, 1e-9);
    expectClose(cw.trepanningPath.theta[2002], -2.002 * Math.PI, 1e-9);
  });

  it('T1-F6-02: 8 Z-planes positions, w(z), and r_abl(z) match Excel defaults', async () => {
    const presets = await loadPresetsContract();
    const compute = await loadTsEngineContract();
    const out = compute(cloneDefaultInput(presets));

    const expectedZ = [-4500, -2500, 0, -1100, -555, -10, 535, 1080];
    const expectedW = [231.1305, 128.5681, 7.7656, 56.9982, 29.5294, 7.7826, 28.5401, 55.9812];
    const expectedRAbl = [NaN, NaN, 11.7181, 30.3581, 28.6498, 11.738, 28.1867, 30.748];

    for (let p = 0; p < 8; p++) {
      expectClose(out.trepanningPath.planeZ[p], expectedZ[p], 1e-6, `planeZ[${p}]`);
      expectClose(out.trepanningPath.planeW[p], expectedW[p], 1e-4, `planeW[${p}]`);
      if (Number.isNaN(expectedRAbl[p])) {
        expect(Number.isNaN(out.trepanningPath.planeRAbl[p])).toBe(true);
      } else {
        expectClose(out.trepanningPath.planeRAbl[p], expectedRAbl[p], 1e-4, `planeRAbl[${p}]`);
      }
    }
  });

  it('T1-F6-03: exact 2-plane nozzle clipping matches Main!S60', async () => {
    const presets = await loadPresetsContract();
    const compute = await loadTsEngineContract();

    const clipOut = compute(cloneDefaultInput(presets));
    expectClose(clipOut.scalars.exitAperture1MaxR_um, GOLDEN_DEFAULT.exitAperture1MaxR_um, 1e-5);
    expectClose(clipOut.scalars.exitAperture2MaxR_um, GOLDEN_DEFAULT.exitAperture2MaxR_um, 1e-5);
    expect(clipOut.scalars.nozzleClipping).toBe(true);

    const clearIn = cloneDefaultInput(presets);
    clearIn.nozzleApertureDia_mm = 1.3; // r_noz = 650 > 605.226
    expect(compute(clearIn).scalars.nozzleClipping).toBe(false);
  });

  it('T1-F6-04: TrepanningCalcs projects Attack_angle = 0.1212713235 rad and rFocus = 175 um', async () => {
    const presets = await loadPresetsContract();
    const compute = await loadTsEngineContract();
    const out = compute(cloneDefaultInput(presets));

    expectClose(out.scalars.rFocus_um, 175, 1e-6, 'rFocus');
    expectClose(out.scalars.attackAngle_rad, GOLDEN_DEFAULT.attackAngle_rad, 1e-4, 'Attack_angle');
    expect(out.trepanningProfile.length).toBe(1001 * 16);
  });

  it('T1-F6-05: tapered hole wall overcut flags oversized ScanDia exceeding linear hole taper', async () => {
    const presets = await loadPresetsContract();
    const compute = await loadTsEngineContract();

    const safeIn = cloneDefaultInput(presets);
    safeIn.entranceDia_um = 203;
    safeIn.exitDia_um = 653;
    safeIn.endDia_um = 200;
    const safeOut = compute(safeIn);

    const overIn = cloneDefaultInput(presets);
    overIn.endDia_um = 800;
    const overOut = compute(overIn);

    expect(safeOut.scalars.wallOvercut).toBe(false);
    expect(overOut.scalars.wallOvercut).toBe(true);
    expect(overOut.scalars.maxOvercut_um).toBeGreaterThan(0);
  });

  it('T1-F6-06: 101-state Transition Mode Safety Sweep captures clipping transition across t=0..100', async () => {
    const presets = await loadPresetsContract();
    const compute = await loadTsEngineContract();
    const input = cloneDefaultInput(presets);
    input.stateMode = 'transition';
    input.startDia_um = 100;
    input.startAOI = -2;
    input.startZ = -500;
    input.endDia_um = 600;
    input.endAOI = -7.5;
    input.endZ = -1100;
    input.nozzleApertureDia_mm = 1.0;

    const out = compute(input);
    expect(out.transitionSweep.length).toBe(101 * 3);
    expect(out.transitionSweep[0]).toBe(0); // t=0 safe
    expect(out.transitionSweep[100 * 3]).toBe(1); // t=100 clipped

    // Verify monotonic onset of clipping in this linear sweep
    let seenClip = false;
    for (let t = 0; t <= 100; t++) {
      const clip = out.transitionSweep[t * 3];
      expect(clip === 0 || clip === 1).toBe(true);
      if (clip === 1) seenClip = true;
      if (seenClip) expect(clip).toBe(1);
    }
  });

  it('T2-F6-01: 2-plane nozzle clipping enforces strict < vs >= boundary at NozzleApertureDia * 500', async () => {
    const presets = await loadPresetsContract();
    const compute = await loadTsEngineContract();
    const baseOut = compute(cloneDefaultInput(presets));
    const exactDiaMm = baseOut.scalars.exitAperture1MaxR_um / 500;

    const justClear = cloneDefaultInput(presets);
    justClear.nozzleApertureDia_mm = exactDiaMm + 1e-4;
    expect(compute(justClear).scalars.nozzleClipping).toBe(false);

    const exactBoundary = cloneDefaultInput(presets);
    exactBoundary.nozzleApertureDia_mm = exactDiaMm;
    expect(compute(exactBoundary).scalars.nozzleClipping).toBe(true);

    const justClip = cloneDefaultInput(presets);
    justClip.nozzleApertureDia_mm = exactDiaMm - 1e-4;
    expect(compute(justClip).scalars.nozzleClipping).toBe(true);
  });

  it('T2-F6-02: nozzle clipping triggers when either Exit Aperture 1 or Exit Aperture 2 clips independently', async () => {
    const presets = await loadPresetsContract();
    const compute = await loadTsEngineContract();

    // Case A: default clips on Exit Aperture 1 (605.226 >= 500) while Exit 2 clears (258.621 < 500)
    const caseA = compute(cloneDefaultInput(presets));
    expect(caseA.scalars.exitAperture1MaxR_um).toBeGreaterThan(500);
    expect(caseA.scalars.exitAperture2MaxR_um).toBeLessThan(500);
    expect(caseA.scalars.nozzleClipping).toBe(true);

    // Case B: reverse cone with positive AOI and focus below nozzle so Exit 2 >= r_noz while Exit 1 < r_noz
    const caseBIn = cloneDefaultInput(presets);
    caseBIn.endDia_um = 400;
    caseBIn.endAOI = 7.5;
    caseBIn.endZ = 5000; // Scanlab: z_shift = -5000; Exit2 z = +3600, Exit1 z = +1600
    caseBIn.nozzleApertureDia_mm = 0.7; // r_noz = 350 um
    const caseB = compute(caseBIn);
    expect(caseB.scalars.exitAperture2MaxR_um).toBeGreaterThanOrEqual(350);
    expect(caseB.scalars.exitAperture1MaxR_um).toBeLessThan(350);
    expect(caseB.scalars.nozzleClipping).toBe(true);
  });

  it('T2-F6-03: ScanDia = 0 clamps Scan_r to 0.001 um so contours remain finite without NaN', async () => {
    const presets = await loadPresetsContract();
    const compute = await loadTsEngineContract();
    const input = cloneDefaultInput(presets);
    input.startDia_um = 0;
    input.endDia_um = 0;

    const out = compute(input);
    expect(Number.isFinite(out.scalars.exitAperture1MaxR_um)).toBe(true);
    expect(Number.isFinite(out.trepanningPath.plane1e2XY[0])).toBe(true);
    expect(Number.isFinite(out.trepanningPath.plane1e2XY[1])).toBe(true);
  });

  it('T2-F6-04: Rotation1 = 90 deg avoids division-by-zero outward normal singularity', async () => {
    const presets = await loadPresetsContract();
    const compute = await loadTsEngineContract();
    const input = cloneDefaultInput(presets);
    input.rotation1_deg = 90;
    input.phase1_deg = 0;

    const out = compute(input);
    expect(Number.isFinite(out.scalars.exitAperture1MaxR_um)).toBe(true);
    expect(Number.isFinite(out.scalars.exitAperture2MaxR_um)).toBe(true);
    for (let i = 0; i < out.trepanningPath.plane1e2XY.length; i++) {
      expect(Number.isFinite(out.trepanningPath.plane1e2XY[i])).toBe(true);
    }
    for (let i = 0; i < out.trepanningPath.planeAblXY.length; i++) {
      expect(Number.isFinite(out.trepanningPath.planeAblXY[i])).toBe(true);
    }
  });

  it('T2-F6-05: non-zero focusRelZ_um shifts plane waist asymmetrically while preserving optical waist AblatedSpot@0', async () => {
    const presets = await loadPresetsContract();
    const compute = await loadTsEngineContract();

    const baseOut = compute(cloneDefaultInput(presets));
    const shiftedIn = cloneDefaultInput(presets);
    shiftedIn.focusRelZ_um = 200;
    const shiftedOut = compute(shiftedIn);

    expectClose(shiftedOut.scalars.ablatedSpotAt0_um, baseOut.scalars.ablatedSpotAt0_um, 1e-9);
    // Focus plane z_p = 0 has w_p evaluated at z_p - focusRelZ = -200 um > w0
    expect(shiftedOut.trepanningPath.planeW[2]).toBeGreaterThan(baseOut.trepanningPath.planeW[2]);
    // Forward Top Right w(z) Z at s=0 shifts by focusRelZ * cos(alpha)
    const fwdZ0 = shiftedOut.trepanningProfile[4 * 2]; // curve 4 (FWD_TOP_RIGHT_W), point 0 Z
    const baseFwdZ0 = baseOut.trepanningProfile[4 * 2];
    expect(fwdZ0).not.toBe(baseFwdZ0);
  });

  it('T2-F6-06: Mat_thk <= 0 guards wallOvercut to false and maxOvercut_um to 0', async () => {
    const presets = await loadPresetsContract();
    const compute = await loadTsEngineContract();
    const input = cloneDefaultInput(presets);
    input.materialThick_um = 0;
    input.endDia_um = 800;

    const out = compute(input);
    expect(out.scalars.wallOvercut).toBe(false);
    expect(out.scalars.maxOvercut_um).toBe(0);
  });
});

describe('Tier 1 & Tier 2 — F7 WASM, TS Fallback, Worker & Schema', () => {
  it('T1-F7-01: compiled src/wasm/engine.wasm exists and instantiates cleanly via loader', async () => {
    const wasmPath = assertDeliverableExists('src/wasm/engine.wasm', 'M2');
    const bytes = fs.readFileSync(wasmPath);
    expect(bytes[0]).toBe(0x00);
    expect(bytes[1]).toBe(0x61);
    expect(bytes[2]).toBe(0x73);
    expect(bytes[3]).toBe(0x6d);

    const presets = await loadPresetsContract();
    const wasm = await loadWasmRunnerContract();
    const out = wasm.compute(cloneDefaultInput(presets));
    expectClose(out.scalars.pulseEnergyOutput_uJ, GOLDEN_DEFAULT.pulseEnergyOutput_uJ, 1e-9);
  });

  it('T1-F7-02: WASM and TS fallback engines achieve numerical parity across 5 varied configs', async () => {
    const presets = await loadPresetsContract();
    const tsCompute = await loadTsEngineContract();
    const wasm = await loadWasmRunnerContract();

    const configs = [
      cloneDefaultInput(presets),
      (() => {
        const i = cloneDefaultInput(presets);
        i.laserId = findLaserByName(presets, 'Charmilles Femto FlexiPulse Green').id;
        i.scanheadId = findScanheadByName(presets, 'Scanlab PrecSYS Green').id;
        i.pulseWidthOverride_fs = null;
        return i;
      })(),
      (() => {
        const i = cloneDefaultInput(presets);
        i.scanheadId = findScanheadByName(presets, 'Arges Elephant v2 IR').id;
        i.holeType = 'square';
        i.direction = 'CW';
        return i;
      })(),
      (() => {
        const i = cloneDefaultInput(presets);
        i.stateMode = 'transition';
        i.transitionProgress_pct = 37.5;
        i.jobScaling = 1.25;
        i.nodeScaling = 0.85;
        i.focusRelZ_um = 150;
        return i;
      })(),
      (() => {
        const i = cloneDefaultInput(presets);
        i.laserId = findLaserByName(presets, 'Coherent Monaco').id;
        i.basePower_W = 60;
        i.baseRepRate_kHz = 1000;
        i.divider = 10;
        i.divergenceMode = 'legacy';
        return i;
      })(),
    ];

    for (let idx = 0; idx < configs.length; idx++) {
      const tsOut = tsCompute(configs[idx]);
      const wasmOut = wasm.compute(configs[idx]);

      for (const [k, tsVal] of Object.entries(tsOut.scalars)) {
        const wVal = wasmOut.scalars[k];
        if (typeof tsVal === 'boolean') {
          expect(wVal, `config[${idx}].scalars.${k}`).toBe(tsVal);
        } else if (typeof tsVal === 'number') {
          if (Number.isNaN(tsVal)) {
            expect(Number.isNaN(wVal), `config[${idx}].scalars.${k} NaN`).toBe(true);
          } else {
            expectClose(wVal as number, tsVal, 1e-10, `config[${idx}].scalars.${k}`);
          }
        }
      }

      expect(wasmOut.isofluence.length).toBe(tsOut.isofluence.length);
      for (let j = 0; j < tsOut.isofluence.length; j += 17) {
        const a = tsOut.isofluence[j];
        const b = wasmOut.isofluence[j];
        if (Number.isNaN(a)) {
          expect(Number.isNaN(b), `isofluence[${j}] NaN mismatch`).toBe(true);
        } else {
          expectClose(b, a, 1e-10, `isofluence[${j}]`);
        }
      }

      for (let j = 0; j < tsOut.transitionSweep.length; j++) {
        expectClose(wasmOut.transitionSweep[j], tsOut.transitionSweep[j], 1e-10, `sweep[${j}]`);
      }
    }
  });

  it('T1-F7-03: Dedicated Module Web Worker computes via WASM and returns Transferable Float64Array', async () => {
    const harness = await startViteWorkerHarnessServer();
    try {
      await withCdpPage(async (page) => {
        await page.navigate(harness.url);
        await page.waitFor('window.__e2eReady === true');
        const res = await page.evaluate<{
          backend: unknown;
          computeMs: unknown;
          pulseEnergyOutput_uJ: number;
          spotSize_um: number;
          focusDistLength: number;
          hasSab: boolean;
        }>(`(async () => {
          const out = await window.__e2eWorker.compute(window.__e2eWorker.defaultInput);
          const output = out.output || out;
          return {
            backend: out.backend,
            computeMs: out.computeMs,
            pulseEnergyOutput_uJ: output.scalars.pulseEnergyOutput_uJ,
            spotSize_um: output.scalars.spotSize_um,
            focusDistLength: output.focusDist instanceof Float64Array ? output.focusDist.length : -1,
            hasSab: typeof SharedArrayBuffer !== 'undefined' && (output.focusDist?.buffer instanceof SharedArrayBuffer),
          };
        })()`);

        expect(page.consoleErrors).toEqual([]);
        expect(page.pageErrors).toEqual([]);
        expect(res.backend).toBe('wasm');
        expect(typeof res.computeMs === 'number' && Number.isFinite(res.computeMs) && res.computeMs >= 0).toBe(true);
        expect(res.focusDistLength).toBe(601 * 5);
        expect(res.hasSab).toBe(false);
        expectClose(res.pulseEnergyOutput_uJ, GOLDEN_DEFAULT.pulseEnergyOutput_uJ, 1e-6);
        expectClose(res.spotSize_um, GOLDEN_DEFAULT.spotSize_um, 1e-6);
      });
    } finally {
      await harness.close();
    }
  });

  it('T1-F7-04: PhysicsClient cancels stale in-flight requests so rapid sequence resolves exclusively to latest input', async () => {
    const harness = await startViteWorkerHarnessServer();
    try {
      await withCdpPage(async (page) => {
        await page.navigate(harness.url);
        await page.waitFor('window.__e2eReady === true');
        const res = await page.evaluate<{
          settledCount: number;
          cancelledCount: number;
          lastPower: number;
        }>(`(async () => {
          const powers = [10, 20, 30, 40, 77];
          const settled = [];
          let cancelled = 0;
          await Promise.all(powers.map((p) => {
            const inp = structuredClone(window.__e2eWorker.defaultInput);
            inp.basePower_W = p;
            return window.__e2eWorker.compute(inp)
              .then((r) => {
                if (r === null) {
                  cancelled++;
                  return;
                }
                const output = r.output || r;
                settled.push(output.scalars.avgPower_W);
              })
              .catch(() => {
                cancelled++;
              });
          }));
          return {
            settledCount: settled.length,
            cancelledCount: cancelled,
            lastPower: settled[settled.length - 1],
          };
        })()`);

        expect(page.pageErrors).toEqual([]);
        expect(res.settledCount).toBe(1);
        expect(res.cancelledCount).toBe(4);
        // 77 W / divider 4 * 90% = 17.325 W
        expectClose(res.lastPower, (77 / 4) * 0.9, 1e-6, 'latest request avgPower');
      });
    } finally {
      await harness.close();
    }
  });

  it('T1-F7-05: Worker automatically falls back to TypeScript engine when .wasm returns 404', async () => {
    const harness = await startViteWorkerHarnessServer();
    try {
      await withCdpPage(async (page) => {
        await page.blockWasmWith404();
        await page.navigate(harness.url);
        await page.waitFor('window.__e2eReady === true');
        const res = await page.evaluate<{
          backend: string;
          pulseEnergyOutput_uJ: number;
          spotSize_um: number;
        }>(`(async () => {
          const out = await window.__e2eWorker.compute(window.__e2eWorker.defaultInput);
          const output = out.output || out;
          return {
            backend: out.backend,
            pulseEnergyOutput_uJ: output.scalars.pulseEnergyOutput_uJ,
            spotSize_um: output.scalars.spotSize_um,
          };
        })()`);

        expect(page.pageErrors).toEqual([]);
        expect(res.backend).toBe('ts');
        expectClose(res.pulseEnergyOutput_uJ, GOLDEN_DEFAULT.pulseEnergyOutput_uJ, 1e-6);
        expectClose(res.spotSize_um, GOLDEN_DEFAULT.spotSize_um, 1e-6);
      });
    } finally {
      await harness.close();
    }
  });

  it('T2-F7-01: WASM/Worker produces isolated buffers without corrupting prior unpacked views', async () => {
    const presets = await loadPresetsContract();
    const wasm = await loadWasmRunnerContract();

    const in1 = cloneDefaultInput(presets);
    in1.basePower_W = 40;
    const out1 = wasm.compute(in1);
    const out1FocusCenter = out1.focusDist[300 * 5 + 2];
    const out1IsoAbl0 = out1.isofluence[9];

    const in2 = cloneDefaultInput(presets);
    in2.basePower_W = 80;
    const out2 = wasm.compute(in2);

    expectClose(out1.scalars.pulseEnergyOutput_uJ, 180, 1e-9, 'out1 preserved');
    expectClose(out2.scalars.pulseEnergyOutput_uJ, 360, 1e-9, 'out2 independent');
    expect(out1.focusDist.buffer).not.toBe(out2.focusDist.buffer);
    expect(out1.focusDist.buffer.byteLength).toBeGreaterThan(0);
    expect(out1.focusDist[300 * 5 + 2]).toBe(out1FocusCenter);
    expect(out1.isofluence[9]).toBe(out1IsoAbl0);

    const harness = await startViteWorkerHarnessServer();
    try {
      await withCdpPage(async (page) => {
        await page.navigate(harness.url);
        await page.waitFor('window.__e2eReady === true');
        const workerRes = await page.evaluate<{
          sameBuffer: boolean;
          out1ByteLengthAfter: number;
          out1IsoBefore: number;
          out1IsoAfter: number;
          out2IsoAfter: number;
          out1Energy: number;
          out2Energy: number;
        }>(`(async () => {
          const inp1 = structuredClone(window.__e2eWorker.defaultInput);
          inp1.basePower_W = 40;
          const r1 = await window.__e2eWorker.compute(inp1);
          const o1 = r1.output || r1;
          const out1IsoBefore = o1.isofluence[9];

          const inp2 = structuredClone(window.__e2eWorker.defaultInput);
          inp2.basePower_W = 80;
          const r2 = await window.__e2eWorker.compute(inp2);
          const o2 = r2.output || r2;

          return {
            sameBuffer: o1.focusDist.buffer === o2.focusDist.buffer,
            out1ByteLengthAfter: o1.focusDist.buffer.byteLength,
            out1IsoBefore,
            out1IsoAfter: o1.isofluence[9],
            out2IsoAfter: o2.isofluence[9],
            out1Energy: o1.scalars.pulseEnergyOutput_uJ,
            out2Energy: o2.scalars.pulseEnergyOutput_uJ,
          };
        })()`);

        expect(workerRes.sameBuffer).toBe(false);
        expect(workerRes.out1ByteLengthAfter).toBeGreaterThan(0);
        expect(workerRes.out1IsoAfter).toBe(workerRes.out1IsoBefore);
        expect(workerRes.out2IsoAfter).toBeGreaterThan(workerRes.out1IsoAfter);
        expectClose(workerRes.out1Energy, 180, 1e-6);
        expectClose(workerRes.out2Energy, 360, 1e-6);
      });
    } finally {
      await harness.close();
    }
  });

  it('T2-F7-02: WASM and TS fallback produce identical NaN masks when PeakFluence < AblationThreshold', async () => {
    const presets = await loadPresetsContract();
    const tsCompute = await loadTsEngineContract();
    const wasm = await loadWasmRunnerContract();

    const input = cloneDefaultInput(presets);
    input.ablationThreshOverride_J_cm2 = 500;

    const tsOut = tsCompute(input);
    const wasmOut = wasm.compute(input);

    for (let r = 0; r < 1001; r += 25) {
      expect(Number.isNaN(tsOut.isofluence[r * 22 + 9])).toBe(true);
      expect(Number.isNaN(wasmOut.isofluence[r * 22 + 9])).toBe(true);
      expect(Number.isNaN(tsOut.isofluence[r * 22 + 20])).toBe(true);
      expect(Number.isNaN(wasmOut.isofluence[r * 22 + 20])).toBe(true);
    }
    expect(Number.isNaN(tsOut.trepanningPath.planeRAbl[2])).toBe(true);
    expect(Number.isNaN(wasmOut.trepanningPath.planeRAbl[2])).toBe(true);
    expect(Number.isNaN(tsOut.trepanningPath.planeAblXY[0])).toBe(true);
    expect(Number.isNaN(wasmOut.trepanningPath.planeAblXY[0])).toBe(true);
  });

  it('T2-F7-03: malformed Worker message does not permanently crash worker or block valid requests', async () => {
    const harness = await startViteWorkerHarnessServer();
    try {
      await withCdpPage(async (page) => {
        await page.navigate(harness.url);
        await page.waitFor('window.__e2eReady === true');
        const res = await page.evaluate<{
          malformedOutcome: string;
          validOutput: number;
        }>(`(async () => {
          const malformed = await window.__e2eWorker.rawWorkerTest();
          const valid = await window.__e2eWorker.compute(window.__e2eWorker.defaultInput);
          const output = valid.output || valid;
          return {
            malformedOutcome: malformed.type,
            validOutput: output.scalars.pulseEnergyOutput_uJ,
          };
        })()`);

        expect(res.malformedOutcome).not.toBe('error');
        expectClose(res.validOutput, GOLDEN_DEFAULT.pulseEnergyOutput_uJ, 1e-6);
      });
    } finally {
      await harness.close();
    }
  });

  it('T2-F7-04: rapid 20-burst input churn settles cleanly to the 20th request without errors', async () => {
    const harness = await startViteWorkerHarnessServer();
    try {
      await withCdpPage(async (page) => {
        await page.navigate(harness.url);
        await page.waitFor('window.__e2eReady === true');
        const res = await page.evaluate<{
          settledCount: number;
          cancelledCount: number;
          finalEnergy: number;
        }>(`(async () => {
          let settledCount = 0;
          let cancelledCount = 0;
          let last = null;
          const promises = [];
          for (let k = 1; k <= 20; k++) {
            const inp = structuredClone(window.__e2eWorker.defaultInput);
            inp.basePower_W = 20 + k;
            promises.push(
              window.__e2eWorker.compute(inp)
                .then((r) => {
                  if (r === null) {
                    cancelledCount++;
                  } else {
                    settledCount++;
                    last = (r.output || r).scalars.pulseEnergyOutput_uJ;
                  }
                })
                .catch(() => {
                  cancelledCount++;
                })
            );
          }
          await Promise.all(promises);
          return { settledCount, cancelledCount, finalEnergy: last };
        })()`);

        expect(page.consoleErrors).toEqual([]);
        expect(page.pageErrors).toEqual([]);
        expect(res.settledCount).toBe(1);
        expect(res.cancelledCount).toBe(19);
        // 20th input has basePower_W = 40 -> 180 uJ
        expectClose(res.finalEnergy, 180, 1e-6);
      });
    } finally {
      await harness.close();
    }
  });

  it('T2-F7-05: WASM f64 precision matches TS at exp(-50) and 1e-6 micron scales', async () => {
    const presets = await loadPresetsContract();
    const tsCompute = await loadTsEngineContract();
    const wasm = await loadWasmRunnerContract();

    const input = cloneDefaultInput(presets);
    input.ablationThreshOverride_J_cm2 = 1e-22;
    input.zFromFocusLookup_um = 1e-6;

    const tsOut = tsCompute(input);
    const wasmOut = wasm.compute(input);

    expectClose(wasmOut.scalars.thresholdR, 5.0, 1e-12);
    expectClose(wasmOut.scalars.thresholdR, tsOut.scalars.thresholdR, 1e-12);
    expectClose(wasmOut.scalars.ablatedSpotAt0_um, tsOut.scalars.ablatedSpotAt0_um, 1e-10);
  });
});
