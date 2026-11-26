/**
 * 3D Trepanning Kinematics (`Trepanning path calcs`), 2-plane nozzle clipping (`Main!S60`),
 * Cross-Section Rigid-Body Transforms (`TrepanningCalcs`), Tapered Wall Overcut,
 * and 101-State Transition Mode Safety Sweep.
 */

import {
  ABL_PLANE_COUNT,
  CONTOUR_STEPS,
  ISO_COL,
  ISO_POINTS,
  ISO_STRIDE,
  PATH_STEPS,
  PLANE_COUNT,
  PLANE_INDEX,
  PROFILE_CURVE,
  PROFILE_POINTS,
  PROFILE_STRIDE,
  SWEEP_STATES,
  SWEEP_STRIDE,
  type ResolvedPhysicsInput,
} from '../types/physics.ts';
import {
  computeIsofluenceRadiusForIntensity,
  computeIsofluenceZMax,
} from './isofluence.ts';

const DEG_TO_RAD = Math.PI / 180;

export interface ActiveTrepanningState {
  activeScanDia_um: number;
  activeAOI: number;
  activeZ: number;
  totalXYScaling: number;
  effectiveScanRadius_um: number;
  aoiSquareScaling: number;
  attackPct: number;
  zShift_um: number;
}

export function resolveActiveState(
  resolved: Pick<
    ResolvedPhysicsInput,
    | 'stateMode'
    | 'transitionProgress_pct'
    | 'startDia_um'
    | 'startAOI'
    | 'startZ'
    | 'endDia_um'
    | 'endAOI'
    | 'endZ'
    | 'jobScaling'
    | 'nodeScaling'
    | 'scanheadBrand'
    | 'holeType'
    | 'maxZTravel_um'
  >,
  overrideTNorm?: number,
): ActiveTrepanningState {
  let activeScanDia_um = resolved.endDia_um;
  let activeAOI = resolved.endAOI;
  let activeZ = resolved.endZ;

  if (overrideTNorm !== undefined) {
    const t = Math.max(0, Math.min(1, overrideTNorm));
    activeScanDia_um = resolved.startDia_um + t * (resolved.endDia_um - resolved.startDia_um);
    activeAOI = resolved.startAOI + t * (resolved.endAOI - resolved.startAOI);
    activeZ = resolved.startZ + t * (resolved.endZ - resolved.startZ);
  } else if (resolved.stateMode === 'transition') {
    const t = Math.max(0, Math.min(100, resolved.transitionProgress_pct)) / 100;
    activeScanDia_um = resolved.startDia_um + t * (resolved.endDia_um - resolved.startDia_um);
    activeAOI = resolved.startAOI + t * (resolved.endAOI - resolved.startAOI);
    activeZ = resolved.startZ + t * (resolved.endZ - resolved.startZ);
  }

  const totalXYScaling = resolved.jobScaling * resolved.nodeScaling;
  const effectiveScanRadius_um =
    resolved.scanheadBrand === 'Arges' || resolved.holeType === 'square'
      ? activeScanDia_um * totalXYScaling
      : (activeScanDia_um / 2) * totalXYScaling;

  const aoiSquareScaling =
    resolved.scanheadBrand === 'Scanlab' && resolved.holeType === 'square'
      ? Math.SQRT1_2
      : 1.0;

  const attackPct =
    resolved.scanheadBrand === 'Arges' ? activeAOI : -activeAOI * aoiSquareScaling;

  const zShift_um =
    resolved.scanheadBrand === 'Arges'
      ? (activeZ / 100) * resolved.maxZTravel_um
      : -activeZ;

  return {
    activeScanDia_um,
    activeAOI,
    activeZ,
    totalXYScaling,
    effectiveScanRadius_um,
    aoiSquareScaling,
    attackPct,
    zShift_um,
  };
}

export interface TrepanningPathSummary {
  exitAperture1MaxR_um: number;
  exitAperture2MaxR_um: number;
  nozzleApertureRadius_um: number;
  nozzleClipping: boolean;
  chartScaleMax_um: number;
  nozzlePlane1Z_um: number;
  nozzlePlane2Z_um: number;
}

export interface TrepanningPathOutViews {
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

export function computeTrepanningPath(
  resolved: ResolvedPhysicsInput,
  active: ActiveTrepanningState,
  w0_um: number,
  rayleighRange_um: number,
  peakFluence_J_cm2: number,
  out: TrepanningPathOutViews,
): TrepanningPathSummary {
  const isCW = resolved.direction === 'CW';
  const incTheta = (isCW ? -1 : 1) * (Math.PI / 1000);
  const rScan = active.effectiveScanRadius_um === 0 ? 0.001 : active.effectiveScanRadius_um;
  const phi =
    resolved.scanheadBrand === 'Arges'
      ? -((active.attackPct / 100) * resolved.maxAttack_deg) * DEG_TO_RAD
      : -(active.attackPct * DEG_TO_RAD);

  const phase1 = resolved.phase1_deg * DEG_TO_RAD;
  const rot1 = resolved.rotation1_deg * DEG_TO_RAD;
  const distXYRot = resolved.distXYRotation_deg * DEG_TO_RAD;
  const phase2 = resolved.phase2_deg * DEG_TO_RAD;
  const rot2 = resolved.rotation2_deg * DEG_TO_RAD;

  const xyRot = rot1 + distXYRot;
  const cosXY = Math.cos(xyRot);
  const sinXY = Math.sin(xyRot);
  const cosR2 = Math.cos(rot2);
  const sinR2 = Math.sin(rot2);
  const cosR2m90 = Math.cos(rot2 - Math.PI / 2);
  const sinR2m90 = Math.sin(rot2 - Math.PI / 2);

  const ex = new Float64Array(PATH_STEPS);
  const ey = new Float64Array(PATH_STEPS);
  const jx = new Float64Array(PATH_STEPS);
  const ky = new Float64Array(PATH_STEPS);

  const holeEntR = resolved.entranceDia_um / 2;
  const holeExitR = resolved.exitDia_um / 2;

  for (let i = 0; i < PATH_STEPS; i++) {
    const th = i * incTheta;
    out.theta[i] = th;

    const cosTh = Math.cos(th);
    const sinTh = Math.sin(th);

    const c = rScan * cosTh;
    const d = rScan * Math.sin(th + phase1);
    ex[i] = c * cosXY - d * sinXY;
    ey[i] = c * sinXY + d * cosXY;

    const h = phi * cosTh;
    const ii = phi * Math.sin(th + phase2);
    jx[i] = h * cosR2 - ii * sinR2;
    ky[i] = h * cosR2m90 - ii * sinR2m90;

    const cIdx = i * 2;
    out.holeEntranceXY[cIdx] = holeEntR * cosTh;
    out.holeEntranceXY[cIdx + 1] = holeEntR * sinTh;
    out.holeExitXY[cIdx] = holeExitR * cosTh;
    out.holeExitXY[cIdx + 1] = holeExitR * sinTh;
  }

  const zNoz2 = -resolved.nozzleWD_mm * 1000 - active.zShift_um;
  const zNoz1 = zNoz2 - resolved.nozzleThick_mm * 1000;
  const zTop = resolved.partSurface_Z_um - active.zShift_um;

  out.planeZ[PLANE_INDEX.EXIT_APERTURE_1] = zNoz1;
  out.planeZ[PLANE_INDEX.EXIT_APERTURE_2] = zNoz2;
  out.planeZ[PLANE_INDEX.FOCUS] = 0;
  out.planeZ[PLANE_INDEX.TOP] = zTop;
  out.planeZ[PLANE_INDEX.TOP_25] = zTop + resolved.materialThick_um / 4;
  out.planeZ[PLANE_INDEX.TOP_50] = zTop + resolved.materialThick_um / 2;
  out.planeZ[PLANE_INDEX.TOP_75] = zTop + (3 * resolved.materialThick_um) / 4;
  out.planeZ[PLANE_INDEX.BOTTOM] = zTop + resolved.materialThick_um;

  const xp = new Float64Array(PATH_STEPS);
  const yp = new Float64Array(PATH_STEPS);

  let exitAperture1MaxR_um = 0;
  let exitAperture2MaxR_um = 0;
  let chartScaleMax_um = 0;

  for (let p = 0; p < PLANE_COUNT; p++) {
    const zp = out.planeZ[p];
    const dz = rayleighRange_um > 0 ? (zp - resolved.focusRelZ_um) / rayleighRange_um : 0;
    const wp = w0_um > 0 ? w0_um * Math.sqrt(1 + dz * dz) : 0;
    const rAblP =
      w0_um > 0 && rayleighRange_um > 0
        ? computeIsofluenceRadiusForIntensity(
            w0_um,
            wp,
            peakFluence_J_cm2,
            resolved.ablationThreshold_J_cm2,
          )
        : Number.NaN;

    out.planeW[p] = wp;
    out.planeRAbl[p] = rAblP;

    const centerBase = p * PATH_STEPS * 2;
    for (let i = 0; i < PATH_STEPS; i++) {
      const xVal = ex[i] + zp * Math.sin(jx[i]);
      const yVal = ey[i] + zp * Math.sin(ky[i]);
      xp[i] = xVal;
      yp[i] = yVal;
      out.planeCenterXY[centerBase + i * 2] = xVal;
      out.planeCenterXY[centerBase + i * 2 + 1] = yVal;
    }

    // Zero-safe winding sign using 2D cross product
    let cross = xp[0] * yp[1] - xp[1] * yp[0];
    if (cross === 0) {
      cross = xp[1] * yp[2] - xp[2] * yp[1];
    }
    const sgn = cross > 0 ? 1 : cross < 0 ? -1 : isCW ? -1 : 1;

    const e2Base = p * CONTOUR_STEPS * 2;
    const hasAblPlane = p >= 2;
    const ablBase = (p - 2) * CONTOUR_STEPS * 2;
    const rAblValid = !Number.isNaN(rAblP);

    for (let j = 0; j < CONTOUR_STEPS; j++) {
      const i = j + 1; // 1..2001
      const dx = xp[i + 1] - xp[i - 1];
      const dy = yp[i + 1] - yp[i - 1];

      let tanAngle: number;
      if (dx === 0) {
        tanAngle = dy > 0 ? Math.PI / 2 : dy < 0 ? -Math.PI / 2 : out.theta[i];
      } else {
        tanAngle = dx > 0 ? Math.atan(dy / dx) : Math.atan(dy / dx) + Math.PI;
      }
      const norm = tanAngle - (Math.PI / 2) * sgn;
      const cosN = Math.cos(norm);
      const sinN = Math.sin(norm);

      const x1e2 = xp[i] + wp * cosN;
      const y1e2 = yp[i] + wp * sinN;
      out.plane1e2XY[e2Base + j * 2] = x1e2;
      out.plane1e2XY[e2Base + j * 2 + 1] = y1e2;

      if (p === 0) {
        const r = Math.hypot(x1e2, y1e2);
        if (r > exitAperture1MaxR_um) exitAperture1MaxR_um = r;
      } else if (p === 1) {
        const r = Math.hypot(x1e2, y1e2);
        if (r > exitAperture2MaxR_um) exitAperture2MaxR_um = r;
      } else {
        const ax = Math.abs(x1e2);
        const ay = Math.abs(y1e2);
        if (ax > chartScaleMax_um) chartScaleMax_um = ax;
        if (ay > chartScaleMax_um) chartScaleMax_um = ay;
      }

      if (hasAblPlane && p - 2 < ABL_PLANE_COUNT) {
        if (rAblValid) {
          out.planeAblXY[ablBase + j * 2] = xp[i] + rAblP * cosN;
          out.planeAblXY[ablBase + j * 2 + 1] = yp[i] + rAblP * sinN;
        } else {
          out.planeAblXY[ablBase + j * 2] = Number.NaN;
          out.planeAblXY[ablBase + j * 2 + 1] = Number.NaN;
        }
      }
    }
  }

  const nozzleApertureRadius_um = resolved.nozzleApertureDia_mm * 500;
  const nozzleClipping =
    exitAperture1MaxR_um >= nozzleApertureRadius_um ||
    exitAperture2MaxR_um >= nozzleApertureRadius_um;

  return {
    exitAperture1MaxR_um,
    exitAperture2MaxR_um,
    nozzleApertureRadius_um,
    nozzleClipping,
    chartScaleMax_um,
    nozzlePlane1Z_um: zNoz1,
    nozzlePlane2Z_um: zNoz2,
  };
}

export interface TrepanningProfileSummary {
  rFocus_um: number;
  attackAngle_rad: number;
  wallOvercut: boolean;
  maxOvercut_um: number;
}

export function computeTrepanningProfile(
  resolved: ResolvedPhysicsInput,
  active: ActiveTrepanningState,
  isofluence: Float64Array,
  planeZ: Float64Array,
  planeCenterXY: Float64Array,
  outProfile: Float64Array,
): TrepanningProfileSummary {
  const focusStep0 = PLANE_INDEX.FOCUS * PATH_STEPS * 2;
  const bottomStep0 = PLANE_INDEX.BOTTOM * PATH_STEPS * 2;
  const aa4 = planeCenterXY[focusStep0];
  const ab4 = planeCenterXY[focusStep0 + 1];
  const bo4 = planeCenterXY[bottomStep0];
  const bp4 = planeCenterXY[bottomStep0 + 1];

  const rFocus_um = Math.hypot(aa4, ab4);

  let a18: number;
  if (aa4 === 0) {
    if (ab4 === 0) {
      a18 = resolved.rotation1_deg;
    } else {
      a18 = ab4 > 0 ? Math.PI / 2 : -Math.PI / 2;
    }
  } else {
    a18 = aa4 > 0 ? Math.atan(ab4 / aa4) : Math.atan(ab4 / aa4) + Math.PI;
  }

  const a20 = a18 - resolved.rotation2_deg * DEG_TO_RAD;
  const a21 = Math.hypot(bo4 - aa4, bp4 - ab4);
  const a22 = a21 * Math.cos(a20);
  const dzBottom = Math.abs(planeZ[PLANE_INDEX.BOTTOM] - planeZ[PLANE_INDEX.FOCUS]);

  const attackAngle_rad =
    dzBottom === 0 ? 0 : Math.sign(active.attackPct) * Math.atan(a22 / -dzBottom);

  const cosFwd = Math.cos(attackAngle_rad);
  const sinFwd = Math.sin(attackAngle_rad);
  const cosBwd = Math.cos(attackAngle_rad + Math.PI);
  const sinBwd = Math.sin(attackAngle_rad + Math.PI);

  const partSurface = resolved.partSurface_Z_um;
  const matThk = resolved.materialThick_um;
  const partBottom = partSurface + matThk;
  const holeEntR = resolved.entranceDia_um / 2;
  const holeExitR = resolved.exitDia_um / 2;
  const checkOvercut = matThk > 0;

  let wallOvercut = false;
  let maxOvercut_um = 0;

  for (let k = 0; k < PROFILE_POINTS; k++) {
    const isoBase = k * ISO_STRIDE;
    const s = isofluence[isoBase + ISO_COL.Z];
    const w = isofluence[isoBase + ISO_COL.POS_W];
    const rAbl = isofluence[isoBase + ISO_COL.POS_ABL];

    const sFwd = s + resolved.focusRelZ_um;
    const sBwd = s - resolved.focusRelZ_um;
    const pBase = k * PROFILE_STRIDE;

    // Curve 0: Forward Top Right Abl (+rAbl)
    const c0Z = sFwd * cosFwd - rAbl * sinFwd + active.zShift_um;
    const c0R = sFwd * sinFwd + rAbl * cosFwd + rFocus_um;
    // Curve 1: Forward Bottom Right Abl (-rAbl)
    const c1Z = sFwd * cosFwd + rAbl * sinFwd + active.zShift_um;
    const c1R = sFwd * sinFwd - rAbl * cosFwd + rFocus_um;
    // Curve 2: Backward Bottom Left Abl (+rAbl, alpha + PI)
    const c2Z = sBwd * cosBwd - rAbl * sinBwd + active.zShift_um;
    const c2R = sBwd * sinBwd + rAbl * cosBwd + rFocus_um;
    // Curve 3: Backward Top Left Abl (-rAbl, alpha + PI)
    const c3Z = sBwd * cosBwd + rAbl * sinBwd + active.zShift_um;
    const c3R = sBwd * sinBwd - rAbl * cosBwd + rFocus_um;

    // Curve 4: Forward Top Right w(z) (+w)
    const c4Z = sFwd * cosFwd - w * sinFwd + active.zShift_um;
    const c4R = sFwd * sinFwd + w * cosFwd + rFocus_um;
    // Curve 5: Forward Bottom Right w(z) (-w)
    const c5Z = sFwd * cosFwd + w * sinFwd + active.zShift_um;
    const c5R = sFwd * sinFwd - w * cosFwd + rFocus_um;
    // Curve 6: Backward Bottom Left w(z) (+w, alpha + PI)
    const c6Z = sBwd * cosBwd - w * sinBwd + active.zShift_um;
    const c6R = sBwd * sinBwd + w * cosBwd + rFocus_um;
    // Curve 7: Backward Top Left w(z) (-w, alpha + PI)
    const c7Z = sBwd * cosBwd + w * sinBwd + active.zShift_um;
    const c7R = sBwd * sinBwd - w * cosBwd + rFocus_um;

    outProfile[pBase + PROFILE_CURVE.FWD_TOP_RIGHT_ABL * 2] = c0Z;
    outProfile[pBase + PROFILE_CURVE.FWD_TOP_RIGHT_ABL * 2 + 1] = c0R;
    outProfile[pBase + PROFILE_CURVE.FWD_BOT_RIGHT_ABL * 2] = c1Z;
    outProfile[pBase + PROFILE_CURVE.FWD_BOT_RIGHT_ABL * 2 + 1] = c1R;
    outProfile[pBase + PROFILE_CURVE.BWD_BOT_LEFT_ABL * 2] = c2Z;
    outProfile[pBase + PROFILE_CURVE.BWD_BOT_LEFT_ABL * 2 + 1] = c2R;
    outProfile[pBase + PROFILE_CURVE.BWD_TOP_LEFT_ABL * 2] = c3Z;
    outProfile[pBase + PROFILE_CURVE.BWD_TOP_LEFT_ABL * 2 + 1] = c3R;

    outProfile[pBase + PROFILE_CURVE.FWD_TOP_RIGHT_W * 2] = c4Z;
    outProfile[pBase + PROFILE_CURVE.FWD_TOP_RIGHT_W * 2 + 1] = c4R;
    outProfile[pBase + PROFILE_CURVE.FWD_BOT_RIGHT_W * 2] = c5Z;
    outProfile[pBase + PROFILE_CURVE.FWD_BOT_RIGHT_W * 2 + 1] = c5R;
    outProfile[pBase + PROFILE_CURVE.BWD_BOT_LEFT_W * 2] = c6Z;
    outProfile[pBase + PROFILE_CURVE.BWD_BOT_LEFT_W * 2 + 1] = c6R;
    outProfile[pBase + PROFILE_CURVE.BWD_TOP_LEFT_W * 2] = c7Z;
    outProfile[pBase + PROFILE_CURVE.BWD_TOP_LEFT_W * 2 + 1] = c7R;

    if (checkOvercut) {
      for (let c = 0; c < 8; c++) {
        const zPt = outProfile[pBase + c * 2];
        const rPt = outProfile[pBase + c * 2 + 1];
        if (
          Number.isFinite(zPt) &&
          Number.isFinite(rPt) &&
          zPt >= partSurface &&
          zPt <= partBottom
        ) {
          const targetR =
            holeEntR + ((zPt - partSurface) / matThk) * (holeExitR - holeEntR);
          const overcut = Math.abs(rPt) - targetR;
          if (overcut > 0) {
            wallOvercut = true;
            if (overcut > maxOvercut_um) maxOvercut_um = overcut;
          }
        }
      }
    }
  }

  return {
    rFocus_um,
    attackAngle_rad,
    wallOvercut,
    maxOvercut_um,
  };
}

export function mirrorCounterBeam(z: number, r: number): { z: number; r: number } {
  return { z, r: r === 0 ? 0 : -r };
}

/**
 * 101-state Transition Mode Safety Sweep (t = 0..100%).
 * Evaluates exact 2-plane nozzle clipping and tapered wall overcut at each state.
 */
export function computeTransitionSweep(
  resolved: ResolvedPhysicsInput,
  w0_um: number,
  rayleighRange_um: number,
  peakFluence_J_cm2: number,
  outSweep: Float64Array,
): void {
  const isCW = resolved.direction === 'CW';
  const incTheta = (isCW ? -1 : 1) * (Math.PI / 1000);
  const phase1 = resolved.phase1_deg * DEG_TO_RAD;
  const rot1 = resolved.rotation1_deg * DEG_TO_RAD;
  const distXYRot = resolved.distXYRotation_deg * DEG_TO_RAD;
  const phase2 = resolved.phase2_deg * DEG_TO_RAD;
  const rot2 = resolved.rotation2_deg * DEG_TO_RAD;

  const xyRot = rot1 + distXYRot;
  const cosXY = Math.cos(xyRot);
  const sinXY = Math.sin(xyRot);
  const cosR2 = Math.cos(rot2);
  const sinR2 = Math.sin(rot2);
  const cosR2m90 = Math.cos(rot2 - Math.PI / 2);
  const sinR2m90 = Math.sin(rot2 - Math.PI / 2);

  // Precompute unit XY and unit precession arrays across 2,003 steps
  const theta = new Float64Array(PATH_STEPS);
  const ux = new Float64Array(PATH_STEPS);
  const uy = new Float64Array(PATH_STEPS);
  const uj = new Float64Array(PATH_STEPS);
  const uk = new Float64Array(PATH_STEPS);

  for (let i = 0; i < PATH_STEPS; i++) {
    const th = i * incTheta;
    theta[i] = th;
    const cosTh = Math.cos(th);
    const sinP1 = Math.sin(th + phase1);
    ux[i] = cosTh * cosXY - sinP1 * sinXY;
    uy[i] = cosTh * sinXY + sinP1 * cosXY;

    const sinP2 = Math.sin(th + phase2);
    uj[i] = cosTh * cosR2 - sinP2 * sinR2;
    uk[i] = cosTh * cosR2m90 - sinP2 * sinR2m90;
  }

  const xp = new Float64Array(PATH_STEPS);
  const yp = new Float64Array(PATH_STEPS);
  const sinJx = new Float64Array(PATH_STEPS);
  const sinKy = new Float64Array(PATH_STEPS);

  const nozzleApertureRadius_um = resolved.nozzleApertureDia_mm * 500;
  const partSurface = resolved.partSurface_Z_um;
  const matThk = resolved.materialThick_um;
  const partBottom = partSurface + matThk;
  const holeEntR = resolved.entranceDia_um / 2;
  const holeExitR = resolved.exitDia_um / 2;
  const checkOvercut = matThk > 0;
  const validBeam = w0_um > 0 && rayleighRange_um > 0;

  for (let tIdx = 0; tIdx < SWEEP_STATES; tIdx++) {
    const state = resolveActiveState(resolved, tIdx / 100);
    const rScan = state.effectiveScanRadius_um === 0 ? 0.001 : state.effectiveScanRadius_um;
    const phi =
      resolved.scanheadBrand === 'Arges'
        ? -((state.attackPct / 100) * resolved.maxAttack_deg) * DEG_TO_RAD
        : -(state.attackPct * DEG_TO_RAD);

    for (let i = 0; i < PATH_STEPS; i++) {
      sinJx[i] = Math.sin(phi * uj[i]);
      sinKy[i] = Math.sin(phi * uk[i]);
    }

    const zNoz2 = -resolved.nozzleWD_mm * 1000 - state.zShift_um;
    const zNoz1 = zNoz2 - resolved.nozzleThick_mm * 1000;
    const zBottom = partSurface - state.zShift_um + matThk;

    // 2-plane nozzle clipping
    let exit1MaxR = 0;
    let exit2MaxR = 0;
    for (let p = 0; p < 2; p++) {
      const zp = p === 0 ? zNoz1 : zNoz2;
      const dz = rayleighRange_um > 0 ? (zp - resolved.focusRelZ_um) / rayleighRange_um : 0;
      const wp = w0_um > 0 ? w0_um * Math.sqrt(1 + dz * dz) : 0;

      for (let i = 0; i < PATH_STEPS; i++) {
        xp[i] = rScan * ux[i] + zp * sinJx[i];
        yp[i] = rScan * uy[i] + zp * sinKy[i];
      }

      let cross = xp[0] * yp[1] - xp[1] * yp[0];
      if (cross === 0) cross = xp[1] * yp[2] - xp[2] * yp[1];
      const sgn = cross > 0 ? 1 : cross < 0 ? -1 : isCW ? -1 : 1;

      for (let i = 1; i <= CONTOUR_STEPS; i++) {
        const dx = xp[i + 1] - xp[i - 1];
        const dy = yp[i + 1] - yp[i - 1];
        let tanAngle: number;
        if (dx === 0) {
          tanAngle = dy > 0 ? Math.PI / 2 : dy < 0 ? -Math.PI / 2 : theta[i];
        } else {
          tanAngle = dx > 0 ? Math.atan(dy / dx) : Math.atan(dy / dx) + Math.PI;
        }
        const norm = tanAngle - (Math.PI / 2) * sgn;
        const x1e2 = xp[i] + wp * Math.cos(norm);
        const y1e2 = yp[i] + wp * Math.sin(norm);
        const r = Math.hypot(x1e2, y1e2);
        if (p === 0) {
          if (r > exit1MaxR) exit1MaxR = r;
        } else {
          if (r > exit2MaxR) exit2MaxR = r;
        }
      }
    }

    const clipping =
      exit1MaxR >= nozzleApertureRadius_um || exit2MaxR >= nozzleApertureRadius_um;

    // Focus & Bottom step 0 for A4 and A6
    const aa4 = rScan * ux[0];
    const ab4 = rScan * uy[0];
    const bo4 = aa4 + zBottom * sinJx[0];
    const bp4 = ab4 + zBottom * sinKy[0];
    const rFocus = Math.hypot(aa4, ab4);

    let a18: number;
    if (aa4 === 0) {
      if (ab4 === 0) a18 = resolved.rotation1_deg;
      else a18 = ab4 > 0 ? Math.PI / 2 : -Math.PI / 2;
    } else {
      a18 = aa4 > 0 ? Math.atan(ab4 / aa4) : Math.atan(ab4 / aa4) + Math.PI;
    }
    const a20 = a18 - resolved.rotation2_deg * DEG_TO_RAD;
    const a21 = Math.hypot(bo4 - aa4, bp4 - ab4);
    const a22 = a21 * Math.cos(a20);
    const dzBottom = Math.abs(zBottom);
    const attackAngle =
      dzBottom === 0 ? 0 : Math.sign(state.attackPct) * Math.atan(a22 / -dzBottom);

    const cosFwd = Math.cos(attackAngle);
    const sinFwd = Math.sin(attackAngle);
    const cosBwd = Math.cos(attackAngle + Math.PI);
    const sinBwd = Math.sin(attackAngle + Math.PI);

    const zMaxIso = computeIsofluenceZMax(
      matThk,
      partSurface,
      resolved.focusRelZ_um,
      state.zShift_um,
    );
    const zStep = zMaxIso / 1000;

    let wallOvercut = false;
    let maxOvercut = 0;

    if (checkOvercut) {
      for (let k = 0; k < ISO_POINTS; k++) {
        const s = k * zStep;
        const wz = validBeam
          ? w0_um * Math.sqrt(1 + (s / rayleighRange_um) * (s / rayleighRange_um))
          : Number.NaN;
        const rAbl = validBeam
          ? computeIsofluenceRadiusForIntensity(
              w0_um,
              wz,
              peakFluence_J_cm2,
              resolved.ablationThreshold_J_cm2,
            )
          : Number.NaN;

        const sFwd = s + resolved.focusRelZ_um;
        const sBwd = s - resolved.focusRelZ_um;

        // Check all 8 curves: 4 ablation (+/-rAbl fwd/bwd), 4 waist (+/-wz fwd/bwd)
        for (let half = 0; half < 2; half++) {
          const rad = half === 0 ? rAbl : wz;
          if (!Number.isFinite(rad)) continue;

          // Fwd +rad, Fwd -rad, Bwd +rad, Bwd -rad
          const z0 = sFwd * cosFwd - rad * sinFwd + state.zShift_um;
          const r0 = sFwd * sinFwd + rad * cosFwd + rFocus;
          const z1 = sFwd * cosFwd + rad * sinFwd + state.zShift_um;
          const r1 = sFwd * sinFwd - rad * cosFwd + rFocus;
          const z2 = sBwd * cosBwd - rad * sinBwd + state.zShift_um;
          const r2 = sBwd * sinBwd + rad * cosBwd + rFocus;
          const z3 = sBwd * cosBwd + rad * sinBwd + state.zShift_um;
          const r3 = sBwd * sinBwd - rad * cosBwd + rFocus;

          const zs = [z0, z1, z2, z3];
          const rs = [r0, r1, r2, r3];
          for (let m = 0; m < 4; m++) {
            const zPt = zs[m];
            const rPt = rs[m];
            if (zPt >= partSurface && zPt <= partBottom) {
              const targetR =
                holeEntR + ((zPt - partSurface) / matThk) * (holeExitR - holeEntR);
              const overcut = Math.abs(rPt) - targetR;
              if (overcut > 0) {
                wallOvercut = true;
                if (overcut > maxOvercut) maxOvercut = overcut;
              }
            }
          }
        }
      }
    }

    const sBase = tIdx * SWEEP_STRIDE;
    outSweep[sBase] = clipping ? 1 : 0;
    outSweep[sBase + 1] = wallOvercut ? 1 : 0;
    outSweep[sBase + 2] = maxOvercut;
  }
}
