// AssemblyScript WASM Physics Kernel for LaserTrepanningCalculator
// Compiled with: asc assembly/engine.ts --target release --bindings raw -o src/wasm/engine.wasm

const INPUT_LEN: i32 = 44;
const OUTPUT_LEN: i32 = 139525;

const DIST_POINTS: i32 = 601;
const DIST_STRIDE: i32 = 5;

const ISO_POINTS: i32 = 1001;
const ISO_STRIDE: i32 = 22;

const PROFILE_POINTS: i32 = 1001;
const PROFILE_STRIDE: i32 = 16;

const PATH_STEPS: i32 = 2003;
const CONTOUR_STEPS: i32 = 2001;
const PLANE_COUNT: i32 = 8;
const ABL_PLANE_COUNT: i32 = 6;
const SWEEP_STATES: i32 = 101;
const SWEEP_STRIDE: i32 = 3;

const OFFSET_SCALARS: i32 = 0;
const OFFSET_FOCUS_DIST: i32 = 64;
const OFFSET_ISOFLUENCE: i32 = 3069;
const OFFSET_TREPANNING_PROFILE: i32 = 25091;
const OFFSET_PATH_THETA: i32 = 41107;
const OFFSET_PATH_PLANE_Z: i32 = 43110;
const OFFSET_PATH_PLANE_W: i32 = 43118;
const OFFSET_PATH_PLANE_R_ABL: i32 = 43126;
const OFFSET_PATH_PLANE_CENTER_XY: i32 = 43134;
const OFFSET_PATH_PLANE_1E2_XY: i32 = 75182;
const OFFSET_PATH_PLANE_ABL_XY: i32 = 107198;
const OFFSET_PATH_HOLE_ENTRANCE_XY: i32 = 131210;
const OFFSET_PATH_HOLE_EXIT_XY: i32 = 135216;
const OFFSET_TRANSITION_SWEEP: i32 = 139222;

const DEG_TO_RAD: f64 = Math.PI / 180.0;
const SQRT1_2: f64 = 1.0 / Math.SQRT2;
const EXP_NEG_50: f64 = Math.exp(-50.0);

// Static preallocated ABI buffers (zero per-call heap allocations)
const inputBuf = new StaticArray<f64>(INPUT_LEN);
const outputBuf = new StaticArray<f64>(OUTPUT_LEN);

// Static scratch arrays for 2,003-step path & 101-state sweep
const tmpEx = new StaticArray<f64>(PATH_STEPS);
const tmpEy = new StaticArray<f64>(PATH_STEPS);
const tmpJx = new StaticArray<f64>(PATH_STEPS);
const tmpKy = new StaticArray<f64>(PATH_STEPS);
const tmpXp = new StaticArray<f64>(PATH_STEPS);
const tmpYp = new StaticArray<f64>(PATH_STEPS);

const tmpSweepTheta = new StaticArray<f64>(PATH_STEPS);
const tmpUx = new StaticArray<f64>(PATH_STEPS);
const tmpUy = new StaticArray<f64>(PATH_STEPS);
const tmpUj = new StaticArray<f64>(PATH_STEPS);
const tmpUk = new StaticArray<f64>(PATH_STEPS);
const tmpSinJx = new StaticArray<f64>(PATH_STEPS);
const tmpSinKy = new StaticArray<f64>(PATH_STEPS);

const ISO_FRACTIONS = StaticArray.fromArray<f64>([
  0.135, 0.2, 0.3, 0.4, 0.5, 0.7, 0.9,
]);

export function getInputPtr(): usize {
  return changetype<usize>(inputBuf);
}

export function getInputLength(): i32 {
  return INPUT_LEN;
}

export function getOutputPtr(): usize {
  return changetype<usize>(outputBuf);
}

export function getOutputLength(): i32 {
  return OUTPUT_LEN;
}

@inline
function negNoZero(v: f64): f64 {
  if (isNaN(v)) return NaN;
  return v == 0.0 ? 0.0 : -v;
}

@inline
function computeIsoRadiusForIntensity(
  w0: f64,
  wz: f64,
  peakFluence: f64,
  targetIntensity: f64,
): f64 {
  if (w0 <= 0.0 || wz <= 0.0 || peakFluence <= 0.0 || targetIntensity <= 0.0) {
    return NaN;
  }
  const wRatio = w0 / wz;
  const iz = peakFluence * wRatio * wRatio;
  const arg = Math.log(iz / targetIntensity);
  if (arg < 0.0) return NaN;
  return Math.sqrt(((wz * wz) / 2.0) * arg);
}

@inline
function computeIsoZMax(
  matThk: f64,
  partSurface: f64,
  focusRelZ: f64,
  zShift: f64,
): f64 {
  const a = Math.abs(matThk + partSurface - focusRelZ);
  const b = Math.abs(partSurface - focusRelZ);
  return (a > b ? a : b) * 1.1 + Math.abs(zShift);
}

@inline
function clamp01(v: f64): f64 {
  if (v < 0.0) return 0.0;
  if (v > 1.0) return 1.0;
  return v;
}

function computeInternal(runSweep: bool): void {
  // Read inputs
  const isSquare = unchecked(inputBuf[0]) >= 0.5;
  const isArges = unchecked(inputBuf[1]) >= 0.5;
  const isCW = unchecked(inputBuf[2]) >= 0.5;
  const isLegacyDiv = unchecked(inputBuf[3]) >= 0.5;
  const isTransition = unchecked(inputBuf[4]) >= 0.5;
  const transitionProgressPct = unchecked(inputBuf[5]);
  const laserColor = unchecked(inputBuf[6]);
  const scanheadColor = unchecked(inputBuf[7]);

  const basePowerW = unchecked(inputBuf[8]);
  const baseRepRateKHz = unchecked(inputBuf[9]);
  const divider = unchecked(inputBuf[10]);
  const attenuatorPct = unchecked(inputBuf[11]);
  const scanSpeedHz = unchecked(inputBuf[12]);

  const wavelengthUm = unchecked(inputBuf[13]);
  const pulseWidthFs = unchecked(inputBuf[14]);
  const focalLengthMm = unchecked(inputBuf[15]);
  const beamDiameterMm = unchecked(inputBuf[16]);
  const mSquared = unchecked(inputBuf[17]);
  const transmissionPct = unchecked(inputBuf[18]);
  const maxAttackDeg = unchecked(inputBuf[19]);
  const maxZTravelUm = unchecked(inputBuf[20]);
  const ablationThreshold = unchecked(inputBuf[21]);
  const focusRelZ = unchecked(inputBuf[22]);
  const nozzleApertureDiaMm = unchecked(inputBuf[23]);
  const nozzleWDMm = unchecked(inputBuf[24]);
  const nozzleThickMm = unchecked(inputBuf[25]);

  const entranceDiaUm = unchecked(inputBuf[26]);
  const exitDiaUm = unchecked(inputBuf[27]);
  const matThkUm = unchecked(inputBuf[28]);
  const partSurfaceUm = unchecked(inputBuf[29]);

  const startDiaUm = unchecked(inputBuf[30]);
  const startAOI = unchecked(inputBuf[31]);
  const startZ = unchecked(inputBuf[32]);
  const endDiaUm = unchecked(inputBuf[33]);
  const endAOI = unchecked(inputBuf[34]);
  const endZ = unchecked(inputBuf[35]);

  const jobScaling = unchecked(inputBuf[36]);
  const nodeScaling = unchecked(inputBuf[37]);
  const phase1Deg = unchecked(inputBuf[38]);
  const rotation1Deg = unchecked(inputBuf[39]);
  const phase2Deg = unchecked(inputBuf[40]);
  const rotation2Deg = unchecked(inputBuf[41]);
  const distXYRotationDeg = unchecked(inputBuf[42]);
  const zFromFocusLookupUm = unchecked(inputBuf[43]);

  // Active state
  let activeScanDiaUm = endDiaUm;
  let activeAOI = endAOI;
  let activeZ = endZ;
  if (isTransition) {
    const t = clamp01(transitionProgressPct / 100.0);
    activeScanDiaUm = startDiaUm + t * (endDiaUm - startDiaUm);
    activeAOI = startAOI + t * (endAOI - startAOI);
    activeZ = startZ + t * (endZ - startZ);
  }

  const totalXYScaling = jobScaling * nodeScaling;
  const effectiveScanRadiusUm =
    isArges || isSquare
      ? activeScanDiaUm * totalXYScaling
      : (activeScanDiaUm / 2.0) * totalXYScaling;

  const aoiSquareScaling: f64 = !isArges && isSquare ? SQRT1_2 : 1.0;
  const attackPct = isArges ? activeAOI : -activeAOI * aoiSquareScaling;
  const zShiftUm = isArges ? (activeZ / 100.0) * maxZTravelUm : -activeZ;

  // Optics
  const outputRepRateKHz = divider > 0.0 ? baseRepRateKHz / divider : 0.0;
  const pulseEnergyBaseUJ =
    baseRepRateKHz > 0.0 ? (basePowerW / baseRepRateKHz) * 1000.0 : 0.0;
  const pulseEnergyOutputUJ =
    pulseEnergyBaseUJ * (attenuatorPct / 100.0) * (transmissionPct / 100.0);
  const avgPowerW =
    divider > 0.0
      ? (basePowerW / divider) * (attenuatorPct / 100.0) * (transmissionPct / 100.0)
      : 0.0;

  const peakPowerMW =
    pulseWidthFs > 0.0
      ? ((2.0 * pulseEnergyOutputUJ * 1e-6) / (pulseWidthFs * 1e-15)) *
        Math.sqrt(Math.LN2 / Math.PI) /
        1e6
      : 0.0;

  const spotSizeUm =
    beamDiameterMm > 0.0
      ? ((4.0 * wavelengthUm * mSquared) / Math.PI) *
        (focalLengthMm / beamDiameterMm)
      : 0.0;
  const w0Um = spotSizeUm / 2.0;

  const rayleighRangeUm =
    wavelengthUm > 0.0 && mSquared > 0.0
      ? (Math.PI * (w0Um / mSquared) * (w0Um / mSquared)) / wavelengthUm
      : 0.0;

  const w0Cm = w0Um * 1e-4;
  const peakFluence =
    w0Cm > 0.0
      ? (2.0 * pulseEnergyOutputUJ * 1e-6) / (Math.PI * w0Cm * w0Cm)
      : 0.0;

  const peakIrradiance =
    pulseWidthFs > 0.0 && w0Cm > 0.0
      ? ((4.0 * pulseEnergyOutputUJ * 1e-6) /
          (pulseWidthFs * 1e-15 * Math.PI * w0Cm * w0Cm)) *
        Math.sqrt(Math.LN2 / Math.PI) /
        1e12
      : 0.0;

  const avgIrradiance = (peakFluence * outputRepRateKHz * 1000.0) / 1e6;

  const scanSpeedMmS = !isSquare
    ? (effectiveScanRadiusUm * scanSpeedHz * 2.0 * Math.PI) / 1000.0
    : scanSpeedHz * totalXYScaling;

  const repRateHz = outputRepRateKHz * 1000.0;
  const spotOverlapPct =
    repRateHz > 0.0 && spotSizeUm > 0.0
      ? (1.0 - ((scanSpeedMmS / repRateHz) * 1000.0) / spotSizeUm) * 100.0
      : 0.0;

  let ablatedSpotAt0Um: f64 = 0.0;
  if (peakFluence > ablationThreshold && ablationThreshold > 0.0) {
    ablatedSpotAt0Um =
      2.0 *
      Math.sqrt(((w0Um * w0Um) / 2.0) * Math.log(peakFluence / ablationThreshold));
  }

  const thresholdRatio: f64 =
    peakFluence > 0.0 ? ablationThreshold / peakFluence : NaN;
  let thresholdR: f64 = 0.0;
  if (peakFluence > 0.0) {
    if (thresholdRatio < EXP_NEG_50) {
      thresholdR = 5.0;
    } else {
      const negHalfLn = -0.5 * Math.log(thresholdRatio);
      thresholdR = negHalfLn < 0.0 ? 0.0 : Math.sqrt(negHalfLn);
    }
  }

  const energyAboveThreshPct: f64 =
    thresholdR == 0.0 ? 0.0 : 100.0 * (1.0 - Math.exp(-2.0 * thresholdR * thresholdR));

  const divScale: f64 = isLegacyDiv ? 100.0 : 1000.0;
  const beamDivergenceMrad: f64 =
    w0Um > 0.0 ? (wavelengthUm / (w0Um * Math.PI)) * divScale : 0.0;

  // 1. Focus Energy Distribution (601 * 5)
  for (let i: i32 = 0; i < DIST_POINTS; i++) {
    const base = OFFSET_FOCUS_DIST + i * DIST_STRIDE;
    const rNorm = <f64>(-300 + i) / 100.0;
    const rUm = rNorm * w0Um;
    const gaussian = Math.exp(-2.0 * rNorm * rNorm);
    const noAblation =
      peakFluence > 0.0 && gaussian > thresholdRatio ? 0.0 : gaussian;
    const ablation = gaussian - noAblation;

    unchecked((outputBuf[base + 0] = rUm));
    unchecked((outputBuf[base + 1] = rNorm));
    unchecked((outputBuf[base + 2] = gaussian));
    unchecked((outputBuf[base + 3] = noAblation));
    unchecked((outputBuf[base + 4] = ablation));
  }

  // 2. Isofluence Lines (1001 * 22)
  const zMaxIsofluence = computeIsoZMax(
    matThkUm,
    partSurfaceUm,
    focusRelZ,
    zShiftUm,
  );
  const zStep = zMaxIsofluence / 1000.0;
  const thermThresh = ablationThreshold / 64.0;
  const validBeam = w0Um > 0.0 && rayleighRangeUm > 0.0;

  for (let i: i32 = 0; i < ISO_POINTS; i++) {
    const base = OFFSET_ISOFLUENCE + i * ISO_STRIDE;
    const z = <f64>i * zStep;
    const zRatio = validBeam ? z / rayleighRangeUm : 0.0;
    const wz = validBeam ? w0Um * Math.sqrt(1.0 + zRatio * zRatio) : NaN;

    unchecked((outputBuf[base + 0] = z));
    unchecked((outputBuf[base + 1] = wz));
    unchecked((outputBuf[base + 12] = negNoZero(wz)));
    unchecked((outputBuf[base + 11] = NaN));

    for (let fIdx: i32 = 0; fIdx < 7; fIdx++) {
      const f = unchecked(ISO_FRACTIONS[fIdx]);
      let r: f64 = NaN;
      if (validBeam && peakFluence > 0.0) {
        const wRatio = w0Um / wz;
        const arg = Math.log((wRatio * wRatio) / f);
        if (arg >= 0.0) {
          r = Math.sqrt(((wz * wz) / 2.0) * arg);
        }
      }
      unchecked((outputBuf[base + 2 + fIdx] = r));
      unchecked((outputBuf[base + 13 + fIdx] = negNoZero(r)));
    }

    const rAbl = validBeam
      ? computeIsoRadiusForIntensity(w0Um, wz, peakFluence, ablationThreshold)
      : NaN;
    unchecked((outputBuf[base + 9] = rAbl));
    unchecked((outputBuf[base + 20] = negNoZero(rAbl)));

    const rTherm = validBeam
      ? computeIsoRadiusForIntensity(w0Um, wz, peakFluence, thermThresh)
      : NaN;
    unchecked((outputBuf[base + 10] = rTherm));
    unchecked((outputBuf[base + 21] = negNoZero(rTherm)));
  }

  // 3. Z From Focus VLOOKUP
  let ablatedSpotAtLookupZ: f64 = NaN;
  if (isFinite(zFromFocusLookupUm) && zFromFocusLookupUm >= 0.0) {
    let lo: i32 = 0;
    let hi: i32 = ISO_POINTS - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >>> 1;
      if (unchecked(outputBuf[OFFSET_ISOFLUENCE + mid * ISO_STRIDE]) <= zFromFocusLookupUm) {
        lo = mid;
      } else {
        hi = mid - 1;
      }
    }
    const rAblLookup = unchecked(
      outputBuf[OFFSET_ISOFLUENCE + lo * ISO_STRIDE + 9],
    );
    ablatedSpotAtLookupZ = isNaN(rAblLookup) ? NaN : 2.0 * rAblLookup;
  }

  // 4. 3D Trepanning Path & 8 Z-Planes
  const incTheta: f64 = (isCW ? -1.0 : 1.0) * (Math.PI / 1000.0);
  const rScan: f64 = effectiveScanRadiusUm == 0.0 ? 0.001 : effectiveScanRadiusUm;
  const phi: f64 = isArges
    ? -((attackPct / 100.0) * maxAttackDeg) * DEG_TO_RAD
    : -(attackPct * DEG_TO_RAD);

  const phase1 = phase1Deg * DEG_TO_RAD;
  const rot1 = rotation1Deg * DEG_TO_RAD;
  const distXYRot = distXYRotationDeg * DEG_TO_RAD;
  const phase2 = phase2Deg * DEG_TO_RAD;
  const rot2 = rotation2Deg * DEG_TO_RAD;

  const xyRot = rot1 + distXYRot;
  const cosXY = Math.cos(xyRot);
  const sinXY = Math.sin(xyRot);
  const cosR2 = Math.cos(rot2);
  const sinR2 = Math.sin(rot2);
  const cosR2m90 = Math.cos(rot2 - Math.PI / 2.0);
  const sinR2m90 = Math.sin(rot2 - Math.PI / 2.0);

  const holeEntR = entranceDiaUm / 2.0;
  const holeExitR = exitDiaUm / 2.0;

  for (let i: i32 = 0; i < PATH_STEPS; i++) {
    const th = <f64>i * incTheta;
    unchecked((outputBuf[OFFSET_PATH_THETA + i] = th));

    const cosTh = Math.cos(th);
    const sinTh = Math.sin(th);

    const c = rScan * cosTh;
    const d = rScan * Math.sin(th + phase1);
    unchecked((tmpEx[i] = c * cosXY - d * sinXY));
    unchecked((tmpEy[i] = c * sinXY + d * cosXY));

    const h = phi * cosTh;
    const ii = phi * Math.sin(th + phase2);
    unchecked((tmpJx[i] = h * cosR2 - ii * sinR2));
    unchecked((tmpKy[i] = h * cosR2m90 - ii * sinR2m90));

    const cIdx = i * 2;
    unchecked((outputBuf[OFFSET_PATH_HOLE_ENTRANCE_XY + cIdx] = holeEntR * cosTh));
    unchecked((outputBuf[OFFSET_PATH_HOLE_ENTRANCE_XY + cIdx + 1] = holeEntR * sinTh));
    unchecked((outputBuf[OFFSET_PATH_HOLE_EXIT_XY + cIdx] = holeExitR * cosTh));
    unchecked((outputBuf[OFFSET_PATH_HOLE_EXIT_XY + cIdx + 1] = holeExitR * sinTh));
  }

  const zNoz2 = -nozzleWDMm * 1000.0 - zShiftUm;
  const zNoz1 = zNoz2 - nozzleThickMm * 1000.0;
  const zTop = partSurfaceUm - zShiftUm;

  unchecked((outputBuf[OFFSET_PATH_PLANE_Z + 0] = zNoz1));
  unchecked((outputBuf[OFFSET_PATH_PLANE_Z + 1] = zNoz2));
  unchecked((outputBuf[OFFSET_PATH_PLANE_Z + 2] = 0.0));
  unchecked((outputBuf[OFFSET_PATH_PLANE_Z + 3] = zTop));
  unchecked((outputBuf[OFFSET_PATH_PLANE_Z + 4] = zTop + matThkUm / 4.0));
  unchecked((outputBuf[OFFSET_PATH_PLANE_Z + 5] = zTop + matThkUm / 2.0));
  unchecked((outputBuf[OFFSET_PATH_PLANE_Z + 6] = zTop + (3.0 * matThkUm) / 4.0));
  unchecked((outputBuf[OFFSET_PATH_PLANE_Z + 7] = zTop + matThkUm));

  let exitAperture1MaxR: f64 = 0.0;
  let exitAperture2MaxR: f64 = 0.0;
  let chartScaleMax: f64 = 0.0;

  for (let p: i32 = 0; p < PLANE_COUNT; p++) {
    const zp = unchecked(outputBuf[OFFSET_PATH_PLANE_Z + p]);
    const dz = rayleighRangeUm > 0.0 ? (zp - focusRelZ) / rayleighRangeUm : 0.0;
    const wp = w0Um > 0.0 ? w0Um * Math.sqrt(1.0 + dz * dz) : 0.0;
    const rAblP = validBeam
      ? computeIsoRadiusForIntensity(w0Um, wp, peakFluence, ablationThreshold)
      : NaN;

    unchecked((outputBuf[OFFSET_PATH_PLANE_W + p] = wp));
    unchecked((outputBuf[OFFSET_PATH_PLANE_R_ABL + p] = rAblP));

    const centerBase = OFFSET_PATH_PLANE_CENTER_XY + p * PATH_STEPS * 2;
    for (let i: i32 = 0; i < PATH_STEPS; i++) {
      const xVal = unchecked(tmpEx[i]) + zp * Math.sin(unchecked(tmpJx[i]));
      const yVal = unchecked(tmpEy[i]) + zp * Math.sin(unchecked(tmpKy[i]));
      unchecked((tmpXp[i] = xVal));
      unchecked((tmpYp[i] = yVal));
      unchecked((outputBuf[centerBase + i * 2] = xVal));
      unchecked((outputBuf[centerBase + i * 2 + 1] = yVal));
    }

    let cross =
      unchecked(tmpXp[0]) * unchecked(tmpYp[1]) -
      unchecked(tmpXp[1]) * unchecked(tmpYp[0]);
    if (cross == 0.0) {
      cross =
        unchecked(tmpXp[1]) * unchecked(tmpYp[2]) -
        unchecked(tmpXp[2]) * unchecked(tmpYp[1]);
    }
    const sgn: f64 = cross > 0.0 ? 1.0 : cross < 0.0 ? -1.0 : isCW ? -1.0 : 1.0;

    const e2Base = OFFSET_PATH_PLANE_1E2_XY + p * CONTOUR_STEPS * 2;
    const hasAblPlane = p >= 2 && p - 2 < ABL_PLANE_COUNT;
    const ablBase = OFFSET_PATH_PLANE_ABL_XY + (p - 2) * CONTOUR_STEPS * 2;
    const rAblValid = !isNaN(rAblP);

    for (let j: i32 = 0; j < CONTOUR_STEPS; j++) {
      const i = j + 1;
      const dx = unchecked(tmpXp[i + 1]) - unchecked(tmpXp[i - 1]);
      const dy = unchecked(tmpYp[i + 1]) - unchecked(tmpYp[i - 1]);

      let tanAngle: f64;
      if (dx == 0.0) {
        tanAngle =
          dy > 0.0
            ? Math.PI / 2.0
            : dy < 0.0
              ? -Math.PI / 2.0
              : unchecked(outputBuf[OFFSET_PATH_THETA + i]);
      } else {
        tanAngle =
          dx > 0.0
            ? Math.atan(dy / dx)
            : Math.atan(dy / dx) + Math.PI;
      }
      const norm = tanAngle - (Math.PI / 2.0) * sgn;
      const cosN = Math.cos(norm);
      const sinN = Math.sin(norm);

      const x1e2 = unchecked(tmpXp[i]) + wp * cosN;
      const y1e2 = unchecked(tmpYp[i]) + wp * sinN;
      unchecked((outputBuf[e2Base + j * 2] = x1e2));
      unchecked((outputBuf[e2Base + j * 2 + 1] = y1e2));

      if (p == 0) {
        const r = Math.sqrt(x1e2 * x1e2 + y1e2 * y1e2);
        if (r > exitAperture1MaxR) exitAperture1MaxR = r;
      } else if (p == 1) {
        const r = Math.sqrt(x1e2 * x1e2 + y1e2 * y1e2);
        if (r > exitAperture2MaxR) exitAperture2MaxR = r;
      } else {
        const ax = Math.abs(x1e2);
        const ay = Math.abs(y1e2);
        if (ax > chartScaleMax) chartScaleMax = ax;
        if (ay > chartScaleMax) chartScaleMax = ay;
      }

      if (hasAblPlane) {
        if (rAblValid) {
          unchecked((outputBuf[ablBase + j * 2] = unchecked(tmpXp[i]) + rAblP * cosN));
          unchecked((outputBuf[ablBase + j * 2 + 1] = unchecked(tmpYp[i]) + rAblP * sinN));
        } else {
          unchecked((outputBuf[ablBase + j * 2] = NaN));
          unchecked((outputBuf[ablBase + j * 2 + 1] = NaN));
        }
      }
    }
  }

  const nozzleApertureRadiusUm = nozzleApertureDiaMm * 500.0;
  const nozzleClipping =
    exitAperture1MaxR >= nozzleApertureRadiusUm ||
    exitAperture2MaxR >= nozzleApertureRadiusUm;

  // 5. TrepanningCalcs Cross-Section & Overcut
  const focusStep0 = OFFSET_PATH_PLANE_CENTER_XY + 2 * PATH_STEPS * 2;
  const bottomStep0 = OFFSET_PATH_PLANE_CENTER_XY + 7 * PATH_STEPS * 2;
  const aa4 = unchecked(outputBuf[focusStep0]);
  const ab4 = unchecked(outputBuf[focusStep0 + 1]);
  const bo4 = unchecked(outputBuf[bottomStep0]);
  const bp4 = unchecked(outputBuf[bottomStep0 + 1]);

  const rFocusUm = Math.sqrt(aa4 * aa4 + ab4 * ab4);

  let a18: f64;
  if (aa4 == 0.0) {
    if (ab4 == 0.0) {
      a18 = rotation1Deg;
    } else {
      a18 = ab4 > 0.0 ? Math.PI / 2.0 : -Math.PI / 2.0;
    }
  } else {
    a18 = aa4 > 0.0 ? Math.atan(ab4 / aa4) : Math.atan(ab4 / aa4) + Math.PI;
  }

  const a20 = a18 - rotation2Deg * DEG_TO_RAD;
  const da = bo4 - aa4;
  const db = bp4 - ab4;
  const a21 = Math.sqrt(da * da + db * db);
  const a22 = a21 * Math.cos(a20);
  const dzBottom = Math.abs(
    unchecked(outputBuf[OFFSET_PATH_PLANE_Z + 7]) -
      unchecked(outputBuf[OFFSET_PATH_PLANE_Z + 2]),
  );

  const attackAngleRad: f64 =
    dzBottom == 0.0 ? 0.0 : Math.sign(attackPct) * Math.atan(a22 / -dzBottom);

  const cosFwd = Math.cos(attackAngleRad);
  const sinFwd = Math.sin(attackAngleRad);
  const cosBwd = Math.cos(attackAngleRad + Math.PI);
  const sinBwd = Math.sin(attackAngleRad + Math.PI);

  const partBottom = partSurfaceUm + matThkUm;
  const checkOvercut = matThkUm > 0.0;
  let wallOvercut = false;
  let maxOvercutUm: f64 = 0.0;

  for (let k: i32 = 0; k < PROFILE_POINTS; k++) {
    const isoBase = OFFSET_ISOFLUENCE + k * ISO_STRIDE;
    const s = unchecked(outputBuf[isoBase + 0]);
    const w = unchecked(outputBuf[isoBase + 1]);
    const rAbl = unchecked(outputBuf[isoBase + 9]);

    const sFwd = s + focusRelZ;
    const sBwd = s - focusRelZ;
    const pBase = OFFSET_TREPANNING_PROFILE + k * PROFILE_STRIDE;

    const c0Z = sFwd * cosFwd - rAbl * sinFwd + zShiftUm;
    const c0R = sFwd * sinFwd + rAbl * cosFwd + rFocusUm;
    const c1Z = sFwd * cosFwd + rAbl * sinFwd + zShiftUm;
    const c1R = sFwd * sinFwd - rAbl * cosFwd + rFocusUm;
    const c2Z = sBwd * cosBwd - rAbl * sinBwd + zShiftUm;
    const c2R = sBwd * sinBwd + rAbl * cosBwd + rFocusUm;
    const c3Z = sBwd * cosBwd + rAbl * sinBwd + zShiftUm;
    const c3R = sBwd * sinBwd - rAbl * cosBwd + rFocusUm;

    const c4Z = sFwd * cosFwd - w * sinFwd + zShiftUm;
    const c4R = sFwd * sinFwd + w * cosFwd + rFocusUm;
    const c5Z = sFwd * cosFwd + w * sinFwd + zShiftUm;
    const c5R = sFwd * sinFwd - w * cosFwd + rFocusUm;
    const c6Z = sBwd * cosBwd - w * sinBwd + zShiftUm;
    const c6R = sBwd * sinBwd + w * cosBwd + rFocusUm;
    const c7Z = sBwd * cosBwd + w * sinBwd + zShiftUm;
    const c7R = sBwd * sinBwd - w * cosBwd + rFocusUm;

    unchecked((outputBuf[pBase + 0] = c0Z));
    unchecked((outputBuf[pBase + 1] = c0R));
    unchecked((outputBuf[pBase + 2] = c1Z));
    unchecked((outputBuf[pBase + 3] = c1R));
    unchecked((outputBuf[pBase + 4] = c2Z));
    unchecked((outputBuf[pBase + 5] = c2R));
    unchecked((outputBuf[pBase + 6] = c3Z));
    unchecked((outputBuf[pBase + 7] = c3R));
    unchecked((outputBuf[pBase + 8] = c4Z));
    unchecked((outputBuf[pBase + 9] = c4R));
    unchecked((outputBuf[pBase + 10] = c5Z));
    unchecked((outputBuf[pBase + 11] = c5R));
    unchecked((outputBuf[pBase + 12] = c6Z));
    unchecked((outputBuf[pBase + 13] = c6R));
    unchecked((outputBuf[pBase + 14] = c7Z));
    unchecked((outputBuf[pBase + 15] = c7R));

    if (checkOvercut) {
      for (let c: i32 = 0; c < 8; c++) {
        const zPt = unchecked(outputBuf[pBase + c * 2]);
        const rPt = unchecked(outputBuf[pBase + c * 2 + 1]);
        if (
          isFinite(zPt) &&
          isFinite(rPt) &&
          zPt >= partSurfaceUm &&
          zPt <= partBottom
        ) {
          const targetR =
            holeEntR + ((zPt - partSurfaceUm) / matThkUm) * (holeExitR - holeEntR);
          const overcut = Math.abs(rPt) - targetR;
          if (overcut > 0.0) {
            wallOvercut = true;
            if (overcut > maxOvercutUm) maxOvercutUm = overcut;
          }
        }
      }
    }
  }

  // 6. 101-State Transition Mode Safety Sweep
  if (runSweep) {
    for (let i: i32 = 0; i < PATH_STEPS; i++) {
      const th = <f64>i * incTheta;
      unchecked((tmpSweepTheta[i] = th));
      const cosTh = Math.cos(th);
      const sinP1 = Math.sin(th + phase1);
      unchecked((tmpUx[i] = cosTh * cosXY - sinP1 * sinXY));
      unchecked((tmpUy[i] = cosTh * sinXY + sinP1 * cosXY));

      const sinP2 = Math.sin(th + phase2);
      unchecked((tmpUj[i] = cosTh * cosR2 - sinP2 * sinR2));
      unchecked((tmpUk[i] = cosTh * cosR2m90 - sinP2 * sinR2m90));
    }

    for (let tIdx: i32 = 0; tIdx < SWEEP_STATES; tIdx++) {
    const t = <f64>tIdx / 100.0;
    const sDia = startDiaUm + t * (endDiaUm - startDiaUm);
    const sAOI = startAOI + t * (endAOI - startAOI);
    const sZ = startZ + t * (endZ - startZ);

    const effR =
      isArges || isSquare ? sDia * totalXYScaling : (sDia / 2.0) * totalXYScaling;
    const sAttackPct = isArges ? sAOI : -sAOI * aoiSquareScaling;
    const sZShift = isArges ? (sZ / 100.0) * maxZTravelUm : -sZ;

    const sRScan: f64 = effR == 0.0 ? 0.001 : effR;
    const sPhi: f64 = isArges
      ? -((sAttackPct / 100.0) * maxAttackDeg) * DEG_TO_RAD
      : -(sAttackPct * DEG_TO_RAD);

    for (let i: i32 = 0; i < PATH_STEPS; i++) {
      unchecked((tmpSinJx[i] = Math.sin(sPhi * unchecked(tmpUj[i]))));
      unchecked((tmpSinKy[i] = Math.sin(sPhi * unchecked(tmpUk[i]))));
    }

    const sZNoz2 = -nozzleWDMm * 1000.0 - sZShift;
    const sZNoz1 = sZNoz2 - nozzleThickMm * 1000.0;
    const sZBottom = partSurfaceUm - sZShift + matThkUm;

    let e1Max: f64 = 0.0;
    let e2Max: f64 = 0.0;

    for (let p: i32 = 0; p < 2; p++) {
      const zp = p == 0 ? sZNoz1 : sZNoz2;
      const dz = rayleighRangeUm > 0.0 ? (zp - focusRelZ) / rayleighRangeUm : 0.0;
      const wp = w0Um > 0.0 ? w0Um * Math.sqrt(1.0 + dz * dz) : 0.0;

      for (let i: i32 = 0; i < PATH_STEPS; i++) {
        unchecked((tmpXp[i] = sRScan * unchecked(tmpUx[i]) + zp * unchecked(tmpSinJx[i])));
        unchecked((tmpYp[i] = sRScan * unchecked(tmpUy[i]) + zp * unchecked(tmpSinKy[i])));
      }

      let cross =
        unchecked(tmpXp[0]) * unchecked(tmpYp[1]) -
        unchecked(tmpXp[1]) * unchecked(tmpYp[0]);
      if (cross == 0.0) {
        cross =
          unchecked(tmpXp[1]) * unchecked(tmpYp[2]) -
          unchecked(tmpXp[2]) * unchecked(tmpYp[1]);
      }
      const sgn: f64 = cross > 0.0 ? 1.0 : cross < 0.0 ? -1.0 : isCW ? -1.0 : 1.0;

      for (let i: i32 = 1; i <= CONTOUR_STEPS; i++) {
        const dx = unchecked(tmpXp[i + 1]) - unchecked(tmpXp[i - 1]);
        const dy = unchecked(tmpYp[i + 1]) - unchecked(tmpYp[i - 1]);
        let tanAngle: f64;
        if (dx == 0.0) {
          tanAngle =
            dy > 0.0
              ? Math.PI / 2.0
              : dy < 0.0
                ? -Math.PI / 2.0
                : unchecked(tmpSweepTheta[i]);
        } else {
          tanAngle =
            dx > 0.0 ? Math.atan(dy / dx) : Math.atan(dy / dx) + Math.PI;
        }
        const norm = tanAngle - (Math.PI / 2.0) * sgn;
        const x1e2 = unchecked(tmpXp[i]) + wp * Math.cos(norm);
        const y1e2 = unchecked(tmpYp[i]) + wp * Math.sin(norm);
        const r = Math.sqrt(x1e2 * x1e2 + y1e2 * y1e2);
        if (p == 0) {
          if (r > e1Max) e1Max = r;
        } else {
          if (r > e2Max) e2Max = r;
        }
      }
    }

    const sClipping =
      e1Max >= nozzleApertureRadiusUm || e2Max >= nozzleApertureRadiusUm;

    const sAa4 = sRScan * unchecked(tmpUx[0]);
    const sAb4 = sRScan * unchecked(tmpUy[0]);
    const sBo4 = sAa4 + sZBottom * unchecked(tmpSinJx[0]);
    const sBp4 = sAb4 + sZBottom * unchecked(tmpSinKy[0]);
    const sRFocus = Math.sqrt(sAa4 * sAa4 + sAb4 * sAb4);

    let sA18: f64;
    if (sAa4 == 0.0) {
      if (sAb4 == 0.0) sA18 = rotation1Deg;
      else sA18 = sAb4 > 0.0 ? Math.PI / 2.0 : -Math.PI / 2.0;
    } else {
      sA18 = sAa4 > 0.0 ? Math.atan(sAb4 / sAa4) : Math.atan(sAb4 / sAa4) + Math.PI;
    }
    const sA20 = sA18 - rotation2Deg * DEG_TO_RAD;
    const sDa = sBo4 - sAa4;
    const sDb = sBp4 - sAb4;
    const sA21 = Math.sqrt(sDa * sDa + sDb * sDb);
    const sA22 = sA21 * Math.cos(sA20);
    const sDzBottom = Math.abs(sZBottom);
    const sAttackAngle: f64 =
      sDzBottom == 0.0
        ? 0.0
        : Math.sign(sAttackPct) * Math.atan(sA22 / -sDzBottom);

    const sCosFwd = Math.cos(sAttackAngle);
    const sSinFwd = Math.sin(sAttackAngle);
    const sCosBwd = Math.cos(sAttackAngle + Math.PI);
    const sSinBwd = Math.sin(sAttackAngle + Math.PI);

    const sZMaxIso = computeIsoZMax(matThkUm, partSurfaceUm, focusRelZ, sZShift);
    const sZStep = sZMaxIso / 1000.0;

    let sWallOvercut = false;
    let sMaxOvercut: f64 = 0.0;

    if (checkOvercut) {
      for (let k: i32 = 0; k < ISO_POINTS; k++) {
        const s = <f64>k * sZStep;
        const zRatio = validBeam ? s / rayleighRangeUm : 0.0;
        const wz = validBeam ? w0Um * Math.sqrt(1.0 + zRatio * zRatio) : NaN;
        const rAbl = validBeam
          ? computeIsoRadiusForIntensity(w0Um, wz, peakFluence, ablationThreshold)
          : NaN;

        const sFwd = s + focusRelZ;
        const sBwd = s - focusRelZ;

        // Check ablation (+/-rAbl) then waist (+/-wz) across fwd/bwd
        for (let half: i32 = 0; half < 2; half++) {
          const rad = half == 0 ? rAbl : wz;
          if (!isFinite(rad)) continue;

          // Fwd +rad
          const z0 = sFwd * sCosFwd - rad * sSinFwd + sZShift;
          const r0 = sFwd * sSinFwd + rad * sCosFwd + sRFocus;
          if (z0 >= partSurfaceUm && z0 <= partBottom) {
            const tr0 =
              holeEntR + ((z0 - partSurfaceUm) / matThkUm) * (holeExitR - holeEntR);
            const oc0 = Math.abs(r0) - tr0;
            if (oc0 > 0.0) {
              sWallOvercut = true;
              if (oc0 > sMaxOvercut) sMaxOvercut = oc0;
            }
          }

          // Fwd -rad
          const z1 = sFwd * sCosFwd + rad * sSinFwd + sZShift;
          const r1 = sFwd * sSinFwd - rad * sCosFwd + sRFocus;
          if (z1 >= partSurfaceUm && z1 <= partBottom) {
            const tr1 =
              holeEntR + ((z1 - partSurfaceUm) / matThkUm) * (holeExitR - holeEntR);
            const oc1 = Math.abs(r1) - tr1;
            if (oc1 > 0.0) {
              sWallOvercut = true;
              if (oc1 > sMaxOvercut) sMaxOvercut = oc1;
            }
          }

          // Bwd +rad
          const z2 = sBwd * sCosBwd - rad * sSinBwd + sZShift;
          const r2 = sBwd * sSinBwd + rad * sCosBwd + sRFocus;
          if (z2 >= partSurfaceUm && z2 <= partBottom) {
            const tr2 =
              holeEntR + ((z2 - partSurfaceUm) / matThkUm) * (holeExitR - holeEntR);
            const oc2 = Math.abs(r2) - tr2;
            if (oc2 > 0.0) {
              sWallOvercut = true;
              if (oc2 > sMaxOvercut) sMaxOvercut = oc2;
            }
          }

          // Bwd -rad
          const z3 = sBwd * sCosBwd + rad * sSinBwd + sZShift;
          const r3 = sBwd * sSinBwd - rad * sCosBwd + sRFocus;
          if (z3 >= partSurfaceUm && z3 <= partBottom) {
            const tr3 =
              holeEntR + ((z3 - partSurfaceUm) / matThkUm) * (holeExitR - holeEntR);
            const oc3 = Math.abs(r3) - tr3;
            if (oc3 > 0.0) {
              sWallOvercut = true;
              if (oc3 > sMaxOvercut) sMaxOvercut = oc3;
            }
          }
        }
      }
    }

    const sBase = OFFSET_TRANSITION_SWEEP + tIdx * SWEEP_STRIDE;
    unchecked((outputBuf[sBase + 0] = sClipping ? 1.0 : 0.0));
    unchecked((outputBuf[sBase + 1] = sWallOvercut ? 1.0 : 0.0));
    unchecked((outputBuf[sBase + 2] = sMaxOvercut));
    }
  }

  // 7. Pack Scalars
  const wavelengthMismatch = laserColor != scanheadColor;
  const argesSquareWarning = isSquare && isArges;

  unchecked((outputBuf[OFFSET_SCALARS + 0] = pulseEnergyBaseUJ));
  unchecked((outputBuf[OFFSET_SCALARS + 1] = pulseEnergyOutputUJ));
  unchecked((outputBuf[OFFSET_SCALARS + 2] = avgPowerW));
  unchecked((outputBuf[OFFSET_SCALARS + 3] = peakPowerMW));
  unchecked((outputBuf[OFFSET_SCALARS + 4] = spotSizeUm));
  unchecked((outputBuf[OFFSET_SCALARS + 5] = w0Um));
  unchecked((outputBuf[OFFSET_SCALARS + 6] = rayleighRangeUm));
  unchecked((outputBuf[OFFSET_SCALARS + 7] = peakFluence));
  unchecked((outputBuf[OFFSET_SCALARS + 8] = peakIrradiance));
  unchecked((outputBuf[OFFSET_SCALARS + 9] = avgIrradiance));
  unchecked((outputBuf[OFFSET_SCALARS + 10] = scanSpeedMmS));
  unchecked((outputBuf[OFFSET_SCALARS + 11] = spotOverlapPct));
  unchecked((outputBuf[OFFSET_SCALARS + 12] = ablatedSpotAt0Um));
  unchecked((outputBuf[OFFSET_SCALARS + 13] = thresholdR));
  unchecked((outputBuf[OFFSET_SCALARS + 14] = energyAboveThreshPct));
  unchecked((outputBuf[OFFSET_SCALARS + 15] = beamDivergenceMrad));
  unchecked((outputBuf[OFFSET_SCALARS + 16] = ablatedSpotAtLookupZ));

  unchecked((outputBuf[OFFSET_SCALARS + 17] = activeScanDiaUm));
  unchecked((outputBuf[OFFSET_SCALARS + 18] = activeAOI));
  unchecked((outputBuf[OFFSET_SCALARS + 19] = activeZ));
  unchecked((outputBuf[OFFSET_SCALARS + 20] = effectiveScanRadiusUm));
  unchecked((outputBuf[OFFSET_SCALARS + 21] = zShiftUm));
  unchecked((outputBuf[OFFSET_SCALARS + 22] = attackPct));
  unchecked((outputBuf[OFFSET_SCALARS + 23] = attackAngleRad));
  unchecked((outputBuf[OFFSET_SCALARS + 24] = rFocusUm));
  unchecked((outputBuf[OFFSET_SCALARS + 25] = exitAperture1MaxR));
  unchecked((outputBuf[OFFSET_SCALARS + 26] = exitAperture2MaxR));
  unchecked((outputBuf[OFFSET_SCALARS + 27] = nozzleApertureRadiusUm));
  unchecked((outputBuf[OFFSET_SCALARS + 28] = nozzleClipping ? 1.0 : 0.0));
  unchecked((outputBuf[OFFSET_SCALARS + 29] = wallOvercut ? 1.0 : 0.0));
  unchecked((outputBuf[OFFSET_SCALARS + 30] = maxOvercutUm));
  unchecked((outputBuf[OFFSET_SCALARS + 31] = chartScaleMax));
  unchecked((outputBuf[OFFSET_SCALARS + 32] = zMaxIsofluence));
  unchecked((outputBuf[OFFSET_SCALARS + 33] = wavelengthMismatch ? 1.0 : 0.0));
  unchecked((outputBuf[OFFSET_SCALARS + 34] = argesSquareWarning ? 1.0 : 0.0));
  unchecked((outputBuf[OFFSET_SCALARS + 35] = partSurfaceUm));
  unchecked((outputBuf[OFFSET_SCALARS + 36] = matThkUm));
  unchecked((outputBuf[OFFSET_SCALARS + 37] = holeEntR));
  unchecked((outputBuf[OFFSET_SCALARS + 38] = holeExitR));

  unchecked((outputBuf[OFFSET_SCALARS + 39] = thresholdRatio));
  unchecked((outputBuf[OFFSET_SCALARS + 40] = outputRepRateKHz));
  unchecked((outputBuf[OFFSET_SCALARS + 41] = wavelengthUm));
  unchecked((outputBuf[OFFSET_SCALARS + 42] = pulseWidthFs));
  unchecked((outputBuf[OFFSET_SCALARS + 43] = mSquared));
  unchecked((outputBuf[OFFSET_SCALARS + 44] = focalLengthMm));
  unchecked((outputBuf[OFFSET_SCALARS + 45] = beamDiameterMm));
  unchecked((outputBuf[OFFSET_SCALARS + 46] = transmissionPct));
  unchecked((outputBuf[OFFSET_SCALARS + 47] = ablationThreshold));
  unchecked((outputBuf[OFFSET_SCALARS + 48] = focusRelZ));
  unchecked((outputBuf[OFFSET_SCALARS + 49] = nozzleWDMm));
  unchecked((outputBuf[OFFSET_SCALARS + 50] = nozzleThickMm));
  unchecked((outputBuf[OFFSET_SCALARS + 51] = nozzleApertureDiaMm));
  unchecked((outputBuf[OFFSET_SCALARS + 52] = maxAttackDeg));
  unchecked((outputBuf[OFFSET_SCALARS + 53] = maxZTravelUm));
  unchecked((outputBuf[OFFSET_SCALARS + 54] = zNoz1));
  unchecked((outputBuf[OFFSET_SCALARS + 55] = zNoz2));
  unchecked((outputBuf[OFFSET_SCALARS + 56] = aoiSquareScaling));
  unchecked((outputBuf[OFFSET_SCALARS + 57] = totalXYScaling));
  for (let r: i32 = 58; r < 64; r++) {
    unchecked((outputBuf[OFFSET_SCALARS + r] = 0.0));
  }
}

export function compute(): void {
  computeInternal(true);
}

export function computeFast(): void {
  computeInternal(false);
}
