import { readFile } from 'node:fs/promises';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  DEFAULT_CALCULATOR_INPUT,
  HOLE_TYPES,
  LASER_PRESETS,
  SCANHEAD_PRESETS,
  findLaserPreset,
  findScanheadPreset,
  resolvePhysicsInput,
} from '../src/data/presets.ts';
import { computePhysicsTS } from '../src/math/engine.ts';
import { calculateAblatedSpotAtZ } from '../src/math/optics.ts';
import { mirrorCounterBeam } from '../src/math/trepanning.ts';
import {
  DIST_COL,
  DIST_LEN,
  DIST_POINTS,
  DIST_STRIDE,
  ISO_COL,
  ISO_LEN,
  ISO_POINTS,
  ISO_STRIDE,
  OUTPUT_FLOAT_COUNT,
  PLANE_COUNT,
  PROFILE_CURVE,
  PROFILE_LEN,
  SWEEP_LEN,
  SWEEP_STATES,
  SWEEP_STRIDE,
  type CalculatorInput,
  type ComputeBackend,
  type PhysicsOutput,
} from '../src/types/physics.ts';
import {
  loadWasmPhysicsFromBytes,
  type WasmPhysicsInstance,
} from '../src/wasm/loader.ts';
import { PhysicsClient } from '../src/worker/physicsClient.ts';

let wasmEngine: WasmPhysicsInstance;

function withInput(overrides: Partial<CalculatorInput>): CalculatorInput {
  return {
    ...DEFAULT_CALCULATOR_INPUT,
    graphLimits: { ...DEFAULT_CALCULATOR_INPUT.graphLimits },
    ...overrides,
  };
}

function runBackend(backend: ComputeBackend, input: CalculatorInput): PhysicsOutput {
  if (backend === 'wasm') {
    return wasmEngine.compute(input);
  }
  return computePhysicsTS(input);
}

function expectRelClose(actual: number, expected: number, relTol = 1e-5): void {
  if (expected === 0) {
    expect(Math.abs(actual)).toBeLessThanOrEqual(relTol);
    return;
  }
  const relErr = Math.abs(actual - expected) / Math.abs(expected);
  expect(relErr).toBeLessThanOrEqual(relTol);
}

function expectArrayParity(a: Float64Array, b: Float64Array, tol = 1e-10): void {
  expect(a.length).toBe(b.length);
  let maxErr = 0;
  let firstBadIdx = -1;
  let nanMismatchIdx = -1;
  for (let i = 0; i < a.length; i++) {
    const va = a[i];
    const vb = b[i];
    const aNaN = Number.isNaN(va);
    const bNaN = Number.isNaN(vb);
    if (aNaN || bNaN) {
      if (aNaN !== bNaN && nanMismatchIdx === -1) {
        nanMismatchIdx = i;
      }
    } else {
      const denom = Math.max(1, Math.abs(vb));
      const err = Math.abs(va - vb) / denom;
      if (err > maxErr) maxErr = err;
      if (err > tol && firstBadIdx === -1) {
        firstBadIdx = i;
      }
    }
  }
  expect(nanMismatchIdx, `NaN mismatch at index ${nanMismatchIdx}`).toBe(-1);
  expect(
    firstBadIdx,
    `Value mismatch at index ${firstBadIdx} (maxErr=${maxErr})`,
  ).toBe(-1);
  expect(maxErr).toBeLessThanOrEqual(tol);
}

beforeAll(async () => {
  const wasmUrl = new URL('../src/wasm/engine.wasm', import.meta.url);
  const wasmBytes = await readFile(wasmUrl);
  wasmEngine = await loadWasmPhysicsFromBytes(wasmBytes);
});

describe('Equipment Presets (Data Inputs)', () => {
  it('replaces GF with Charmilles and preserves all required laser & scanhead names', () => {
    expect(LASER_PRESETS).toHaveLength(6);
    expect(SCANHEAD_PRESETS).toHaveLength(4);
    expect(HOLE_TYPES).toHaveLength(2);

    const laserNames = LASER_PRESETS.map((p) => p.name);
    const scanheadNames = SCANHEAD_PRESETS.map((p) => p.name);

    for (const name of [...laserNames, ...scanheadNames]) {
      expect(name).not.toContain('GF');
    }

    expect(laserNames).toEqual([
      'Charmilles Femto FlexiPulse IR',
      'Charmilles Femto FlexiPulse Green',
      'Light Conversion Carbide IR',
      'Light Conversion Carbide Green',
      'Coherent Monaco',
      'Manual Input',
    ]);

    expect(scanheadNames).toEqual([
      'Arges Elephant v2 IR',
      'Scanlab PrecSYS IR',
      'Scanlab PrecSYS Green',
      'Manual Input',
    ]);
  });

  it('resolves legacy FFPIR/FFPGR aliases and MANUAL overrides cleanly', () => {
    expect(findLaserPreset('FFPIR').id).toBe('CHARMILLES_IR');
    expect(findLaserPreset('FFPGR').id).toBe('CHARMILLES_GR');
    expect(findScanheadPreset('PE2IR').brand).toBe('Arges');

    const manualLaser = findLaserPreset('MANUAL');
    expect(manualLaser.wavelength_um).toBe(0.515);
    expect(manualLaser.color).toBe('Green');
    expect(manualLaser.pulseWidth_fs).toBe(500);

    const manualHead = findScanheadPreset('MANUAL');
    expect(manualHead.brand).toBe('Scanlab');
    expect(manualHead.color).toBe('Green');
    expect(manualHead.mSquared).toBe(1.05);

    const resolved = resolvePhysicsInput(
      withInput({
        laserId: 'MANUAL',
        scanheadId: 'MANUAL',
        manualLaserWavelength_um: 0.355,
        manualLaserColor: 'IR',
        manualLaserPulseWidth_fs: 420,
        pulseWidthOverride_fs: null,
        manualScanheadBrand: 'Arges',
        manualScanheadColor: 'Green',
        manualScanheadFocalLength_mm: 100,
        manualScanheadBeamDia_mm: 10,
        manualScanheadTransmission_pct: 88,
        manualScanheadM2: 1.15,
        manualScanheadMaxAttack_deg: 12,
        manualScanheadMaxZTravel_um: 1200,
      }),
    );

    expect(resolved.wavelength_um).toBe(0.355);
    expect(resolved.laserColor).toBe('IR');
    expect(resolved.pulseWidth_fs).toBe(420);
    expect(resolved.scanheadBrand).toBe('Arges');
    expect(resolved.scanheadColor).toBe('Green');
    expect(resolved.focalLength_mm).toBe(100);
    expect(resolved.beamDiameter_mm).toBe(10);
    expect(resolved.transmission_pct).toBe(88);
    expect(resolved.mSquared).toBe(1.15);
    expect(resolved.maxAttack_deg).toBe(12);
    expect(resolved.maxZTravel_um).toBe(1200);
  });
});

describe.each<ComputeBackend>(['wasm', 'ts'])('Physics Engine (%s)', (backend) => {
  it('matches all 18 default-state golden reference values', () => {
    const out = runBackend(backend, DEFAULT_CALCULATOR_INPUT);
    const s = out.scalars;

    expectRelClose(s.pulseEnergyBase_uJ, 200, 1e-5);
    expectRelClose(s.pulseEnergyOutput_uJ, 180, 1e-5);
    expectRelClose(s.avgPower_W, 9, 1e-5);
    expectRelClose(s.peakPower_MW, 338.1974203, 1e-5);
    expectRelClose(s.spotSize_um, 15.5312488, 1e-5);
    expectRelClose(s.rayleighRange_um, 151.2783974, 1e-5);
    expectRelClose(s.peakFluence_J_cm2, 190.0202414, 1e-5);
    expectRelClose(s.peakIrradiance_TW_cm2, 357.0241970, 1e-5);
    expectRelClose(s.avgIrradiance_MW_cm2, 9.5010121, 1e-5);
    expectRelClose(s.scanSpeed_mm_s, 54.9778714, 1e-5);
    expectRelClose(s.spotOverlap_pct, 92.9203540, 1e-4);
    expectRelClose(s.ablatedSpotAt0_um, 23.4361949, 1e-5);
    expectRelClose(s.thresholdR, 1.508970414, 1e-5);
    expectRelClose(s.energyAboveThresh_pct, 98.9474805, 1e-4);
    expectRelClose(s.exitAperture1MaxR_um, 605.225618, 1e-5);
    expectRelClose(s.exitAperture2MaxR_um, 258.620920, 1e-5);
    expect(s.nozzleClipping).toBe(true);
    expectRelClose(s.attackAngle_rad, 0.1212713235, 1e-4);

    // Also verify Scanlab round-hole non-double-division directly
    expect(s.effectiveScanRadius_um).toBeCloseTo(175, 9);
  });

  it('applies XY scaling (jobScaling * nodeScaling) to speed and overlap for Round and Square holes', () => {
    const roundScaled = runBackend(
      backend,
      withInput({ holeType: 'round', jobScaling: 1.5, nodeScaling: 2.0 }),
    );
    expect(roundScaled.scalars.totalXYScaling).toBeCloseTo(3.0, 9);
    expect(roundScaled.scalars.effectiveScanRadius_um).toBeCloseTo(525, 9);
    expectRelClose(roundScaled.scalars.scanSpeed_mm_s, 54.97787143782138 * 3, 1e-6);

    const roundBase = runBackend(backend, DEFAULT_CALCULATOR_INPUT);
    expect(roundScaled.scalars.spotOverlap_pct).toBeLessThan(
      roundBase.scalars.spotOverlap_pct,
    );

    const squareUnscaled = runBackend(
      backend,
      withInput({ holeType: 'square', jobScaling: 1, nodeScaling: 1 }),
    );
    expect(squareUnscaled.scalars.scanSpeed_mm_s).toBeCloseTo(50, 9);

    const squareScaled = runBackend(
      backend,
      withInput({ holeType: 'square', jobScaling: 1.5, nodeScaling: 2.0 }),
    );
    expect(squareScaled.scalars.scanSpeed_mm_s).toBeCloseTo(150, 9);
    expect(squareScaled.scalars.spotOverlap_pct).toBeLessThan(
      squareUnscaled.scalars.spotOverlap_pct,
    );
  });

  it('supports Beam Divergence toggle: current (*1000) default vs legacy (*100)', () => {
    const curr = runBackend(backend, withInput({ divergenceMode: 'current' }));
    const leg = runBackend(backend, withInput({ divergenceMode: 'legacy' }));

    expectRelClose(curr.scalars.beamDivergence_mrad, 42.42424242424241, 1e-6);
    expectRelClose(leg.scalars.beamDivergence_mrad, 4.242424242424241, 1e-6);
  });

  it('emits Arges + Square warning with aoiSquareScaling=1 vs Scanlab + Square 1/sqrt(2)', () => {
    const argesSq = runBackend(
      backend,
      withInput({ scanheadId: 'PE2IR', holeType: 'square' }),
    );
    expect(argesSq.scalars.argesSquareWarning).toBe(true);
    expect(argesSq.scalars.aoiSquareScaling).toBeCloseTo(1, 12);

    const scanlabSq = runBackend(
      backend,
      withInput({ scanheadId: 'SLIR', holeType: 'square' }),
    );
    expect(scanlabSq.scalars.argesSquareWarning).toBe(false);
    expect(scanlabSq.scalars.aoiSquareScaling).toBeCloseTo(Math.SQRT1_2, 12);
  });

  it('detects wavelength/color mismatch warnings', () => {
    const mismatch = runBackend(
      backend,
      withInput({ laserId: 'CARBIDE_IR', scanheadId: 'SLGR' }),
    );
    expect(mismatch.scalars.wavelengthMismatch).toBe(true);

    const matched = runBackend(
      backend,
      withInput({ laserId: 'CARBIDE_GR', scanheadId: 'SLGR' }),
    );
    expect(matched.scalars.wavelengthMismatch).toBe(false);
  });

  it('evaluates Z From Focus lookup (0, intermediate, >zMax, <0)', () => {
    const at0 = runBackend(backend, withInput({ zFromFocusLookup_um: 0 }));
    expectRelClose(at0.scalars.ablatedSpotAtLookupZ_um, 23.4361949, 1e-6);

    const at500 = runBackend(backend, withInput({ zFromFocusLookup_um: 500 }));
    // VLOOKUP floor quantization at z[142] = 496.716 um
    expect(at500.scalars.ablatedSpotAtLookupZ_um).toBeGreaterThan(54);
    expect(at500.scalars.ablatedSpotAtLookupZ_um).toBeLessThan(55);

    const pastZMax = runBackend(backend, withInput({ zFromFocusLookup_um: 5000 }));
    expect(Number.isNaN(pastZMax.scalars.ablatedSpotAtLookupZ_um)).toBe(true);

    const negativeZ = runBackend(backend, withInput({ zFromFocusLookup_um: -10 }));
    expect(Number.isNaN(negativeZ.scalars.ablatedSpotAtLookupZ_um)).toBe(true);
  });

  it('computes 601-pt Focus Distribution and handles below-threshold & EXP(-50) clamp', () => {
    const def = runBackend(backend, DEFAULT_CALCULATOR_INPUT);
    expect(def.focusDist.length).toBe(DIST_LEN);
    expect(def.focusDist[0 * DIST_STRIDE + DIST_COL.R_NORM]).toBe(-3);
    expect(def.focusDist[300 * DIST_STRIDE + DIST_COL.R_NORM]).toBe(0);
    expect(def.focusDist[600 * DIST_STRIDE + DIST_COL.R_NORM]).toBe(3);

    for (let i = 0; i < DIST_POINTS; i++) {
      const b = i * DIST_STRIDE;
      const g = def.focusDist[b + DIST_COL.GAUSSIAN];
      const noAbl = def.focusDist[b + DIST_COL.NO_ABLATION];
      const abl = def.focusDist[b + DIST_COL.ABLATION];
      expect(noAbl + abl).toBeCloseTo(g, 12);
    }

    // Below threshold
    const below = runBackend(
      backend,
      withInput({ ablationThreshOverride_J_cm2: 500 }),
    );
    expect(below.scalars.thresholdR).toBe(0);
    expect(below.scalars.energyAboveThresh_pct).toBe(0);
    expect(below.scalars.ablatedSpotAt0_um).toBe(0);
    for (let i = 0; i < DIST_POINTS; i++) {
      expect(below.focusDist[i * DIST_STRIDE + DIST_COL.ABLATION]).toBe(0);
    }

    // Ultra-high fluence clamp (J2 < exp(-50) => ThresholdR === 5)
    const ultra = runBackend(
      backend,
      withInput({ ablationThreshOverride_J_cm2: 1e-25 }),
    );
    expect(ultra.scalars.thresholdR).toBe(5);
  });

  it('computes 1,001-pt Isofluence lines including I/64 Thermal Damage and NaN cutoffs', () => {
    const def = runBackend(backend, DEFAULT_CALCULATOR_INPUT);
    expect(def.isofluence.length).toBe(ISO_LEN);
    expect(def.scalars.zMaxIsofluence_um).toBeCloseTo(3498, 9);
    expect(def.isofluence[0 * ISO_STRIDE + ISO_COL.Z]).toBe(0);
    expect(def.isofluence[(ISO_POINTS - 1) * ISO_STRIDE + ISO_COL.Z]).toBeCloseTo(3498, 9);

    // Row 15 (z = 52.47) still finite? Actually row 15 z = 15 * 3.498 = 52.47, (w0/w(52.47))^2 = 1/(1+(52.47/151.278)^2) = 0.8927 < 0.9 => row 15 (Excel row 17) is NaN!
    const row15 = 15 * ISO_STRIDE;
    expect(def.isofluence[row15 + ISO_COL.Z]).toBeCloseTo(52.47, 6);
    expect(Number.isNaN(def.isofluence[row15 + ISO_COL.POS_090])).toBe(true);
    expect(Number.isNaN(def.isofluence[row15 + ISO_COL.NEG_090])).toBe(true);
    expect(Number.isNaN(def.isofluence[row15 + ISO_COL.N_SPACER])).toBe(true);

    // Thermal damage (I/64) extends further than Ablation (I)
    expect(def.isofluence[0 + ISO_COL.POS_THERM]).toBeGreaterThan(
      def.isofluence[0 + ISO_COL.POS_ABL],
    );
    expect(def.isofluence[0 + ISO_COL.NEG_THERM]).toBe(
      -def.isofluence[0 + ISO_COL.POS_THERM],
    );
  });

  it('computes 2,003-step 3D path, CCW vs CW, 8 Z-planes, and singularity guards', () => {
    const def = runBackend(backend, DEFAULT_CALCULATOR_INPUT);
    expect(def.trepanningPath.planeZ.length).toBe(PLANE_COUNT);
    expect(def.trepanningPath.theta[1]).toBeGreaterThan(0);
    expectRelClose(def.scalars.chartScaleMax_um, 362.60012454, 1e-6);

    const expectedZ = [-4500, -2500, 0, -1100, -555, -10, 535, 1080];
    for (let p = 0; p < PLANE_COUNT; p++) {
      expect(def.trepanningPath.planeZ[p]).toBeCloseTo(expectedZ[p], 9);
    }

    const cw = runBackend(backend, withInput({ direction: 'CW' }));
    expect(cw.trepanningPath.theta[1]).toBeLessThan(0);

    // Rotation1 = 90 deg normal singularity must produce zero NaNs in plane1e2XY
    const rot90 = runBackend(backend, withInput({ rotation1_deg: 90 }));
    let nonFiniteRot90 = 0;
    for (let i = 0; i < rot90.trepanningPath.plane1e2XY.length; i++) {
      if (!Number.isFinite(rot90.trepanningPath.plane1e2XY[i])) nonFiniteRot90++;
    }
    expect(nonFiniteRot90).toBe(0);

    // Scan Dia = 0 clamps to 0.001 internally and produces zero NaNs in plane1e2XY
    const zeroDia = runBackend(backend, withInput({ endDia_um: 0 }));
    let nonFiniteZeroDia = 0;
    for (let i = 0; i < zeroDia.trepanningPath.plane1e2XY.length; i++) {
      if (!Number.isFinite(zeroDia.trepanningPath.plane1e2XY[i])) nonFiniteZeroDia++;
    }
    expect(nonFiniteZeroDia).toBe(0);
  });

  it('checks exact 2-plane nozzle clipping (Exit1, Exit2, and >= boundary)', () => {
    // Default: Exit1 clips (605.226 >= 500) while Exit2 clears (258.621 < 500)
    const def = runBackend(backend, DEFAULT_CALCULATOR_INPUT);
    expect(def.scalars.exitAperture1MaxR_um).toBeGreaterThan(500);
    expect(def.scalars.exitAperture2MaxR_um).toBeLessThan(500);
    expect(def.scalars.nozzleClipping).toBe(true);

    // Both < R_noz when aperture dia = 1.5 mm (R_noz = 750 um)
    const clear = runBackend(backend, withInput({ nozzleApertureDia_mm: 1.5 }));
    expect(clear.scalars.nozzleClipping).toBe(false);

    // Boundary equality R2 === R_noz => clipping true
    const boundaryDiaMm = def.scalars.exitAperture1MaxR_um / 500;
    const boundary = runBackend(
      backend,
      withInput({ nozzleApertureDia_mm: boundaryDiaMm }),
    );
    expect(boundary.scalars.nozzleClipping).toBe(true);
  });

  it('computes TrepanningCalcs cross-section, guards, waist continuity, and wall overcut', () => {
    const def = runBackend(backend, DEFAULT_CALCULATOR_INPUT);
    expect(def.trepanningProfile.length).toBe(PROFILE_LEN);
    expect(def.scalars.rFocus_um).toBeCloseTo(175, 9);
    expectRelClose(def.scalars.attackAngle_rad, 0.1212713235, 1e-5);
    expect(def.scalars.wallOvercut).toBe(true);
    expect(def.scalars.maxOvercut_um).toBeGreaterThan(30);

    // BP2 - AB2 == 0 guard (materialThick_um = 0, endZ = 0, partSurface_Z_um = 0)
    const zeroDz = runBackend(
      backend,
      withInput({ materialThick_um: 0, endZ: 0, partSurface_Z_um: 0 }),
    );
    expect(zeroDz.scalars.attackAngle_rad).toBe(0);
    expect(Number.isFinite(zeroDz.scalars.attackAngle_rad)).toBe(true);

    // focusRelZ != 0 waist continuity: Z_fwd(0) == Z_bwd(0) and R_fwd(0) == R_bwd(0)
    const shiftedFocus = runBackend(backend, withInput({ focusRelZ_um: 200 }));
    const zFwd = shiftedFocus.trepanningProfile[PROFILE_CURVE.FWD_TOP_RIGHT_W * 2];
    const rFwd = shiftedFocus.trepanningProfile[PROFILE_CURVE.FWD_TOP_RIGHT_W * 2 + 1];
    const zBwd = shiftedFocus.trepanningProfile[PROFILE_CURVE.BWD_TOP_LEFT_W * 2];
    const rBwd = shiftedFocus.trepanningProfile[PROFILE_CURVE.BWD_TOP_LEFT_W * 2 + 1];
    expect(zFwd).toBeCloseTo(zBwd, 9);
    expect(rFwd).toBeCloseTo(rBwd, 9);

    // Start state (250 um, -6 deg, -1100 um) has no wall overcut
    const startState = runBackend(
      backend,
      withInput({
        stateMode: 'transition',
        transitionProgress_pct: 0,
      }),
    );
    expect(startState.scalars.wallOvercut).toBe(false);
    expect(startState.scalars.maxOvercut_um).toBe(0);
  });

  it('computes 101-state Transition Mode Safety Sweep matching Start and End states', () => {
    const out = runBackend(backend, DEFAULT_CALCULATOR_INPUT);
    expect(out.transitionSweep.length).toBe(SWEEP_LEN);

    const startState = runBackend(
      backend,
      withInput({ stateMode: 'transition', transitionProgress_pct: 0 }),
    );
    // State 0 (Start: 250, -6, -1100) => matches Start state (clipping=1 at 1.0mm nozzle, wallOvercut=0)
    expect(out.transitionSweep[0 * SWEEP_STRIDE + 0]).toBe(
      startState.scalars.nozzleClipping ? 1 : 0,
    );
    expect(out.transitionSweep[0 * SWEEP_STRIDE + 1]).toBe(0);
    expect(out.transitionSweep[0 * SWEEP_STRIDE + 2]).toBe(0);

    // State 100 (End: 350, -7, -1100) => clipping=1, wallOvercut=1
    const last = (SWEEP_STATES - 1) * SWEEP_STRIDE;
    expect(out.transitionSweep[last + 0]).toBe(1);
    expect(out.transitionSweep[last + 1]).toBe(1);
    expect(out.transitionSweep[last + 2]).toBeCloseTo(out.scalars.maxOvercut_um, 9);

    // With 1.18mm nozzle (R_noz = 590 um), Start clears (< 590) while End clips (605.226 >= 590)
    const transNozzle = runBackend(
      backend,
      withInput({ nozzleApertureDia_mm: 1.18 }),
    );
    expect(transNozzle.transitionSweep[0 * SWEEP_STRIDE + 0]).toBe(0);
    expect(transNozzle.transitionSweep[last + 0]).toBe(1);

    // Constant sweep when Start === End
    const constOut = runBackend(
      backend,
      withInput({
        startDia_um: 350,
        startAOI: -7,
        startZ: -1100,
      }),
    );
    for (let i = 0; i < SWEEP_STATES; i++) {
      expect(constOut.transitionSweep[i * SWEEP_STRIDE + 0]).toBe(1);
      expect(constOut.transitionSweep[i * SWEEP_STRIDE + 1]).toBe(1);
      expect(constOut.transitionSweep[i * SWEEP_STRIDE + 2]).toBeCloseTo(
        constOut.scalars.maxOvercut_um,
        9,
      );
    }
  });
});

describe('WASM vs TypeScript Full Buffer Parity', () => {
  it('produces matching 139,525-float output buffers across default and varied configurations', () => {
    const configs: CalculatorInput[] = [
      DEFAULT_CALCULATOR_INPUT,
      withInput({
        laserId: 'MONACO',
        scanheadId: 'PE2IR',
        direction: 'CW',
        stateMode: 'transition',
        transitionProgress_pct: 42,
        focusRelZ_um: 150,
        jobScaling: 1.2,
        nodeScaling: 0.9,
      }),
      withInput({
        holeType: 'square',
        scanheadId: 'SLGR',
        laserId: 'CHARMILLES_GR',
        divergenceMode: 'legacy',
      }),
    ];

    for (const cfg of configs) {
      const wasmBuf = wasmEngine.computeBuffer(cfg);
      const tsOut = computePhysicsTS(cfg);
      const wasmOut = wasmEngine.compute(cfg);

      expect(wasmBuf.length).toBe(OUTPUT_FLOAT_COUNT);
      expectArrayParity(wasmOut.focusDist, tsOut.focusDist, 1e-12);
      expectArrayParity(wasmOut.isofluence, tsOut.isofluence, 1e-12);
      expectArrayParity(wasmOut.trepanningProfile, tsOut.trepanningProfile, 1e-11);
      expectArrayParity(wasmOut.trepanningPath.theta, tsOut.trepanningPath.theta, 1e-12);
      expectArrayParity(wasmOut.trepanningPath.planeZ, tsOut.trepanningPath.planeZ, 1e-12);
      expectArrayParity(wasmOut.trepanningPath.planeW, tsOut.trepanningPath.planeW, 1e-12);
      expectArrayParity(wasmOut.trepanningPath.planeRAbl, tsOut.trepanningPath.planeRAbl, 1e-12);
      expectArrayParity(
        wasmOut.trepanningPath.planeCenterXY,
        tsOut.trepanningPath.planeCenterXY,
        1e-11,
      );
      expectArrayParity(
        wasmOut.trepanningPath.plane1e2XY,
        tsOut.trepanningPath.plane1e2XY,
        1e-10,
      );
      expectArrayParity(
        wasmOut.trepanningPath.planeAblXY,
        tsOut.trepanningPath.planeAblXY,
        1e-10,
      );
      expectArrayParity(wasmOut.transitionSweep, tsOut.transitionSweep, 1e-10);
    }
  });
});

describe('Helpers & PhysicsClient Integration', () => {
  it('supports continuous calculateAblatedSpotAtZ and mirrorCounterBeam helpers', () => {
    const def = computePhysicsTS(DEFAULT_CALCULATOR_INPUT);
    const d0 = calculateAblatedSpotAtZ(
      0,
      def.scalars.w0_um,
      def.scalars.rayleighRange_um,
      def.scalars.peakFluence_J_cm2,
      def.scalars.ablationThreshold_J_cm2,
    );
    expectRelClose(d0, 23.4361949, 1e-6);

    const dFar = calculateAblatedSpotAtZ(
      3000,
      def.scalars.w0_um,
      def.scalars.rayleighRange_um,
      def.scalars.peakFluence_J_cm2,
      def.scalars.ablationThreshold_J_cm2,
    );
    expect(Number.isNaN(dFar)).toBe(true);

    expect(mirrorCounterBeam(120, 45)).toEqual({ z: 120, r: -45 });
    expect(mirrorCounterBeam(120, 0)).toEqual({ z: 120, r: 0 });
  });

  it('computes physics cleanly through PhysicsClient (TS fallback in Node)', async () => {
    const client = new PhysicsClient(false);
    const res = await client.compute(DEFAULT_CALCULATOR_INPUT);
    expect(res).not.toBeNull();
    expect(res!.backend).toBe('ts');
    expectRelClose(res!.output.scalars.peakFluence_J_cm2, 190.0202414, 1e-6);
    expect(client.getLastBackend()).toBe('ts');
    expect(client.getLastComputeMs()).toBeGreaterThanOrEqual(0);
    client.terminate();
  });
});
