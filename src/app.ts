/**
 * Main Application Orchestrator for the Laser Trepanning & Ablation Calculator.
 * Connects validated AppState, PhysicsClient (WASM Worker + TS fallback),
 * 4 interactive high-DPI Canvas renderers, Safety Heatmap, PWA install/SW,
 * and modern accessible UI primitives without any dynamic innerHTML.
 */

import {
  DEFAULT_GRAPH_LIMITS,
  HOLE_TYPES,
  LASER_PRESETS,
  SCANHEAD_PRESETS,
  findLaserPreset,
  findScanheadPreset,
} from './data/presets.ts';
import { registerPwaServiceWorker, setupPwaInstall } from './pwa/install.ts';
import type { CrosshairReadout } from './render/baseCanvas.ts';
import {
  FluenceCanvasRenderer,
  type FluenceUnitMode,
} from './render/fluenceCanvas.ts';
import {
  IsofluenceCanvasRenderer,
  type IsofluenceContourKey,
} from './render/isofluenceCanvas.ts';
import {
  ProfileCanvasRenderer,
  type GraphLimitFitMode,
} from './render/profileCanvas.ts';
import {
  TopDownCanvasRenderer,
  renderSafetyHeatmap,
  type TopDownMode,
} from './render/topDownCanvas.ts';
import {
  DEFAULT_STATE,
  cloneAppState,
  parseAndValidateConfigJson,
  serializeAppState,
  toCalculatorInput,
  type AppState,
  type TabId,
} from './state/schema.ts';
import type {
  ColorType,
  Direction,
  DivergenceMode,
  HoleType,
  LaserId,
  PhysicsScalars,
  ScanheadBrand,
  ScanheadId,
} from './types/physics.ts';
import { populateSelect, setHidden, setText } from './ui/domHelpers.ts';
import { bindDialog } from './ui/modals.ts';
import { createTabController, type TabController } from './ui/tabs.ts';
import {
  applyTheme,
  getSavedTheme,
  toggleTheme,
  type ThemeMode,
} from './ui/theme.ts';
import { showToast } from './ui/toast.ts';
import {
  PhysicsClient,
  type PhysicsComputeResult,
} from './worker/physicsClient.ts';

export function formatMetricNumber(
  value: number,
  decimals: number,
  unit = '',
  fallback = '--',
): string {
  if (!Number.isFinite(value)) return fallback;
  const normalized = Object.is(value, -0) || Math.abs(value) < 1e-12 ? 0 : value;
  const formatted = normalized.toFixed(decimals);
  return unit ? `${formatted} ${unit}` : formatted;
}

export function formatAblatedSpotAtZ(value_um: number): string {
  if (!Number.isFinite(value_um)) {
    return 'Below Threshold';
  }
  return formatMetricNumber(value_um, 2, 'µm', 'Below Threshold');
}

export function formatCrosshairReadout(readout: CrosshairReadout | null): string {
  if (!readout) {
    return 'Hover plot for coordinates';
  }
  return `${readout.labelX}  |  ${readout.labelY}`;
}

export function getWarningMessages(
  scalars: Pick<
    PhysicsScalars,
    'wavelengthMismatch' | 'argesSquareWarning'
  >,
  laserColor: ColorType,
  scanheadColor: ColorType,
): { wavelengthWarning: string | null; argesSquareWarning: string | null } {
  return {
    wavelengthWarning: scalars.wavelengthMismatch
      ? `Wavelength Mismatch: Laser (${laserColor}) and Scanhead (${scanheadColor}) optics are configured for different spectral bands.`
      : null,
    argesSquareWarning: scalars.argesSquareWarning
      ? 'Square holes not supported for Arges!'
      : null,
  };
}

export class TrepanningCalculatorApp {
  private state: AppState;
  private theme: ThemeMode;
  private physicsClient: PhysicsClient;
  private lastResult: PhysicsComputeResult | null = null;
  private tabsController: TabController | null = null;

  private profileRenderer!: ProfileCanvasRenderer;
  private topDownRenderer!: TopDownCanvasRenderer;
  private isofluenceRenderer!: IsofluenceCanvasRenderer;
  private fluenceRenderer!: FluenceCanvasRenderer;

  private isPlaying = false;
  private animFrameId: number | null = null;
  private playDirection = 1;
  private isAnimComputeInFlight = false;
  private tableOpenByTab: Record<TabId, boolean> = {
    profile: false,
    topdown: false,
    isofluence: false,
    fluence: false,
  };

  constructor() {
    this.theme = getSavedTheme();
    this.state = cloneAppState(DEFAULT_STATE);
    this.physicsClient = new PhysicsClient();

    this.initSelects();
    this.initRenderers();
    this.initTabsAndModal();
    this.bindEvents();
    this.initPwa();

    this.applyAppTheme(this.theme);
    this.syncInputsWithState();
    void this.recalculate();
  }

  private initSelects(): void {
    populateSelect(
      'selectLaser',
      LASER_PRESETS.map((l) => ({
        value: l.id,
        label: `${l.name} (${l.color})`,
      })),
      this.state.laserId,
    );

    populateSelect(
      'selectScanhead',
      SCANHEAD_PRESETS.map((s) => ({
        value: s.id,
        label: `${s.name} (${s.brand})`,
      })),
      this.state.scanheadId,
    );

    populateSelect(
      'selectHoleType',
      HOLE_TYPES.map((h) => ({
        value: h.id,
        label: h.name,
      })),
      this.state.holeType,
    );
  }

  private initRenderers(): void {
    const profileCanvas = document.getElementById('canvasProfile') as HTMLCanvasElement;
    const topDownCanvas = document.getElementById('canvasTopDown') as HTMLCanvasElement;
    const isoCanvas = document.getElementById('canvasIsofluence') as HTMLCanvasElement;
    const fluenceCanvas = document.getElementById('canvasFluence') as HTMLCanvasElement;

    const onCrosshair = (tab: TabId) => (readout: CrosshairReadout | null) => {
      if (this.state.activeTab === tab) {
        setText('crosshairReadout', formatCrosshairReadout(readout));
      }
    };

    this.profileRenderer = new ProfileCanvasRenderer(
      profileCanvas,
      { defaultTheme: this.theme, onCrosshairChange: onCrosshair('profile') },
      {
        orientation: this.state.orientation,
        showCounterBeam: this.state.showCounterBeam,
        showNozzle: this.state.showProfileNozzle,
        fitMode: this.state.profileFitMode,
        graphLimits: { ...this.state.graphLimits },
      },
    );

    this.topDownRenderer = new TopDownCanvasRenderer(
      topDownCanvas,
      { defaultTheme: this.theme, onCrosshairChange: onCrosshair('topdown') },
      {
        mode: this.state.tab2Mode,
        holeType: this.state.holeType,
        showNozzleRings: this.state.showNozzleRings,
        visiblePlanes: [...this.state.visibleSlicePlanes],
      },
    );
    this.topDownRenderer.setOrbitAngleDeg(this.state.orbitAngleDeg);

    this.isofluenceRenderer = new IsofluenceCanvasRenderer(
      isoCanvas,
      { defaultTheme: this.theme, onCrosshairChange: onCrosshair('isofluence') },
      {
        zFromFocusLookup_um: this.state.zFromFocusLookup_um,
        visibleContours: { ...this.state.isofluenceVisibility },
      },
    );

    this.fluenceRenderer = new FluenceCanvasRenderer(
      fluenceCanvas,
      { defaultTheme: this.theme, onCrosshairChange: onCrosshair('fluence') },
      {
        unitMode: this.state.fluenceUnitMode,
      },
    );
  }

  private initTabsAndModal(): void {
    const tablist = document.getElementById('canvasTabList');
    if (tablist) {
      this.tabsController = createTabController({
        tablist,
        initialTab: this.state.activeTab,
        onTabChange: (tabId) => {
          const nextTab = tabId as TabId;
          this.state.activeTab = nextTab;
          this.syncRendererVisibility(nextTab);
          setText('crosshairReadout', formatCrosshairReadout(null));
          this.syncTableToggleButton(nextTab);
          this.refreshVisibleSummaryTable(nextTab);
          if (nextTab === 'topdown' && this.state.stateMode === 'transition') {
            this.drawSafetyHeatmap();
          }
        },
      });
      this.syncRendererVisibility(this.state.activeTab);
    }

    const guideDialog = document.getElementById('guideModal') as HTMLDialogElement | null;
    const openBtn = document.getElementById('btnOpenGuide');
    const closeBtn = document.getElementById('btnCloseGuide');
    const closeFooterBtn = document.getElementById('btnCloseGuideFooter');
    if (guideDialog) {
      bindDialog(
        guideDialog,
        openBtn ? [openBtn] : [],
        [closeBtn, closeFooterBtn].filter((el): el is HTMLElement => el !== null),
      );
    }
  }

  private syncRendererVisibility(activeTab: TabId): void {
    this.profileRenderer.setVisible(activeTab === 'profile');
    this.topDownRenderer.setVisible(activeTab === 'topdown');
    this.isofluenceRenderer.setVisible(activeTab === 'isofluence');
    this.fluenceRenderer.setVisible(activeTab === 'fluence');
  }

  private getActiveRenderer() {
    switch (this.state.activeTab) {
      case 'profile':
        return this.profileRenderer;
      case 'topdown':
        return this.topDownRenderer;
      case 'isofluence':
        return this.isofluenceRenderer;
      case 'fluence':
        return this.fluenceRenderer;
    }
  }

  private getTableWrapElement(tab: TabId): HTMLElement | null {
    switch (tab) {
      case 'profile':
        return document.getElementById('tableWrapProfile');
      case 'topdown':
        return document.getElementById('tableWrapTopDown');
      case 'isofluence':
        return document.getElementById('tableWrapIsofluence');
      case 'fluence':
        return document.getElementById('tableWrapFluence');
    }
  }

  private syncTableToggleButton(tab: TabId): void {
    const btn = document.getElementById('btnToggleTable');
    if (btn) {
      btn.setAttribute('aria-pressed', this.tableOpenByTab[tab] ? 'true' : 'false');
    }
  }

  private refreshVisibleSummaryTable(tab: TabId): void {
    const wrap = this.getTableWrapElement(tab);
    if (!wrap) return;
    const isOpen = this.tableOpenByTab[tab];
    setHidden(wrap, !isOpen);
    if (!isOpen) return;

    switch (tab) {
      case 'profile':
        this.profileRenderer.renderSummaryTable(wrap);
        break;
      case 'topdown':
        this.topDownRenderer.renderSummaryTable(wrap);
        break;
      case 'isofluence':
        this.isofluenceRenderer.renderSummaryTable(wrap);
        break;
      case 'fluence':
        this.fluenceRenderer.renderSummaryTable(wrap);
        break;
    }
  }

  private initPwa(): void {
    const installBtn = document.getElementById('btnInstallPwa') as HTMLButtonElement | null;
    setupPwaInstall(installBtn);
    registerPwaServiceWorker();
  }

  private bindEvents(): void {
    // Equipment & Divergence
    this.bindSelect('selectLaser', (val) => {
      this.state.laserId = val as LaserId;
      const laser = findLaserPreset(val);
      if (!laser.isManual) {
        this.state.basePower_W = laser.defaultPower_W;
        this.state.baseRepRate_kHz = laser.defaultRepRate_kHz;
        this.state.attenuator_pct = laser.defaultAttenuator_pct;
        this.state.divider = laser.defaultDivider;
        this.setInputValue('inputBasePower', String(laser.defaultPower_W));
        this.setInputValue('inputBaseRepRate', String(laser.defaultRepRate_kHz));
        this.setInputValue('inputAttenuator', String(laser.defaultAttenuator_pct));
        this.setInputValue('inputDivider', String(laser.defaultDivider));
      }
      this.updateManualPanelsVisibility();
      void this.recalculate();
    });

    this.bindSelect('selectScanhead', (val) => {
      this.state.scanheadId = val as ScanheadId;
      this.updateManualPanelsVisibility();
      this.updateDynamicLabels();
      void this.recalculate();
    });

    this.bindSelect('selectHoleType', (val) => {
      this.state.holeType = val as HoleType;
      this.topDownRenderer.setHoleType(this.state.holeType);
      this.updateDynamicLabels();
      void this.recalculate();
    });

    this.bindSelect('selectDivergenceMode', (val) => {
      this.state.divergenceMode = val as DivergenceMode;
      void this.recalculate();
    });

    // Manual Laser Specs
    this.bindNumber('inputManualLaserWavelength', (n) => {
      this.state.manualLaserWavelength_um = n;
    });
    this.bindSelect('selectManualLaserColor', (val) => {
      this.state.manualLaserColor = val as ColorType;
      void this.recalculate();
    });
    this.bindNumber('inputManualLaserPulseWidth', (n) => {
      this.state.manualLaserPulseWidth_fs = n;
    });

    // Manual Scanhead Specs
    this.bindSelect('selectManualScanheadBrand', (val) => {
      this.state.manualScanheadBrand = val as ScanheadBrand;
      this.updateDynamicLabels();
      void this.recalculate();
    });
    this.bindSelect('selectManualScanheadColor', (val) => {
      this.state.manualScanheadColor = val as ColorType;
      void this.recalculate();
    });
    this.bindNumber('inputManualScanheadFocalLength', (n) => {
      this.state.manualScanheadFocalLength_mm = n;
    });
    this.bindNumber('inputManualScanheadBeamDia', (n) => {
      this.state.manualScanheadBeamDia_mm = n;
    });
    this.bindNumber('inputManualScanheadTransmission', (n) => {
      this.state.manualScanheadTransmission_pct = n;
    });
    this.bindNumber('inputManualScanheadScanSpeed', (n) => {
      this.state.manualScanheadScanSpeed_Hz = n;
    });
    this.bindNumber('inputManualScanheadM2', (n) => {
      this.state.manualScanheadM2 = n;
    });
    this.bindNumber('inputManualScanheadMaxAttack', (n) => {
      this.state.manualScanheadMaxAttack_deg = n;
    });
    this.bindNumber('inputManualScanheadMaxZTravel', (n) => {
      this.state.manualScanheadMaxZTravel_um = n;
    });

    // Section 2: Process
    this.bindNumber('inputBasePower', (n) => {
      this.state.basePower_W = n;
    });
    this.bindNumber('inputBaseRepRate', (n) => {
      this.state.baseRepRate_kHz = Math.max(0.001, n);
    });
    this.bindNumber(
      'inputDivider',
      (n) => {
        this.state.divider = Math.max(1, Math.round(n));
      },
      false,
    );
    this.bindNumber('inputAttenuator', (n) => {
      this.state.attenuator_pct = Math.max(0, Math.min(100, n));
    });
    this.bindNumber('inputScanSpeed', (n) => {
      this.state.scanSpeed_Hz = Math.max(0.001, n);
    });

    // Section 3: Hole & Surface
    this.bindNumber('inputEntranceDia', (n) => {
      this.state.entranceDia_um = n;
    });
    this.bindNumber('inputExitDia', (n) => {
      this.state.exitDia_um = n;
    });
    this.bindNumber('inputMaterialThick', (n) => {
      this.state.materialThick_um = Math.max(1, n);
    });
    this.bindNumber('inputPartSurfaceZ', (n) => {
      this.state.partSurface_Z_um = n;
    });

    // Section 4: Kinematics & State Mode
    const radioSingle = document.getElementById('radioSingleState') as HTMLInputElement | null;
    const radioTransition = document.getElementById('radioTransitionState') as HTMLInputElement | null;
    const updateModeFromRadios = () => {
      this.state.stateMode = radioTransition?.checked ? 'transition' : 'single';
      if (this.state.stateMode !== 'transition') {
        this.stopAnimation();
      }
      this.syncTransitionControlsUI();
      void this.recalculate();
    };
    radioSingle?.addEventListener('change', updateModeFromRadios);
    radioTransition?.addEventListener('change', updateModeFromRadios);

    this.bindNumber('inputStartDia', (n) => {
      this.state.startDia_um = n;
    });
    this.bindNumber('inputStartAOI', (n) => {
      this.state.startAOI = n;
    });
    this.bindNumber('inputStartZ', (n) => {
      this.state.startZ = n;
    });

    this.bindNumber('inputEndDia', (n) => {
      this.state.endDia_um = n;
    });
    this.bindNumber('inputEndAOI', (n) => {
      this.state.endAOI = n;
    });
    this.bindNumber('inputEndZ', (n) => {
      this.state.endZ = n;
    });

    const scrubber = document.getElementById('sliderProgress') as HTMLInputElement | null;
    scrubber?.addEventListener('input', () => {
      const val = Number.parseFloat(scrubber.value);
      this.setTransitionProgress(Number.isFinite(val) ? val : 0);
    });

    document.getElementById('btnPlayTransition')?.addEventListener('click', () => {
      this.toggleAnimation();
    });
    document.getElementById('btnStepBack')?.addEventListener('click', () => {
      this.setTransitionProgress(this.state.transitionProgress_pct - 10);
    });
    document.getElementById('btnStepFwd')?.addEventListener('click', () => {
      this.setTransitionProgress(this.state.transitionProgress_pct + 10);
    });

    this.bindSafetyHeatmapScrubbing();

    this.bindNumber('inputJobScaling', (n) => {
      this.state.jobScaling = Math.max(0.01, n);
    });
    this.bindNumber('inputNodeScaling', (n) => {
      this.state.nodeScaling = Math.max(0.01, n);
    });

    this.bindSelect('selectDirection', (val) => {
      this.state.direction = val as Direction;
      void this.recalculate();
    });
    this.bindNumber('inputPhase1', (n) => {
      this.state.phase1_deg = n;
    });
    this.bindNumber('inputRotation1', (n) => {
      this.state.rotation1_deg = n;
    });
    this.bindNumber('inputPhase2', (n) => {
      this.state.phase2_deg = n;
    });
    this.bindNumber('inputRotation2', (n) => {
      this.state.rotation2_deg = n;
    });
    this.bindNumber('inputDistXYRotation', (n) => {
      this.state.distXYRotation_deg = n;
    });

    // Section 5: Overrides (nullable)
    this.bindOverride('overrideM2', 'm2Override');
    this.bindOverride('overridePulseWidth', 'pulseWidthOverride_fs');
    this.bindOverride('overrideFocalLength', 'focalLengthOverride_mm');
    this.bindOverride('overrideBeamDia', 'beamDiaOverride_mm');
    this.bindOverride('overrideTransmission', 'transmissionOverride_pct');
    this.bindOverride('overrideFocusRelZ', 'focusRelZ_um');
    this.bindOverride('overrideNozzleDia', 'nozzleApertureDia_mm');
    this.bindOverride('overrideNozzleWD', 'nozzleWD_mm');
    this.bindOverride('overrideNozzleThick', 'nozzleThick_mm');
    this.bindOverride('overrideMaxAttack', 'maxAttackOverride_deg');
    this.bindOverride('overrideAblationThresh', 'ablationThreshOverride_J_cm2');

    // Section 6: Z Lookup & Graph Limits
    const onZLookupInput = (zVal: number) => {
      this.state.zFromFocusLookup_um = zVal;
      this.setInputValue('inputZFromFocus', String(zVal));
      this.setInputValue('isoZFromFocusMirror', String(zVal));
      this.isofluenceRenderer.setZFromFocus(zVal);
      void this.recalculate();
    };

    const inputZLookup = document.getElementById('inputZFromFocus') as HTMLInputElement | null;
    inputZLookup?.addEventListener('input', () => {
      const val = Number.parseFloat(inputZLookup.value);
      if (Number.isFinite(val)) {
        this.state.zFromFocusLookup_um = val;
        this.setInputValue('isoZFromFocusMirror', String(val));
        this.isofluenceRenderer.setZFromFocus(val);
        void this.recalculate();
      }
    });

    const isoZMirror = document.getElementById('isoZFromFocusMirror') as HTMLInputElement | null;
    isoZMirror?.addEventListener('input', () => {
      const val = Number.parseFloat(isoZMirror.value);
      if (Number.isFinite(val)) {
        onZLookupInput(val);
      }
    });

    const bindGraphLimit = (
      id: string,
      key: keyof AppState['graphLimits'],
    ) => {
      const el = document.getElementById(id) as HTMLInputElement | null;
      el?.addEventListener('input', () => {
        const val = Number.parseFloat(el.value);
        if (Number.isFinite(val)) {
          this.state.graphLimits = {
            ...this.state.graphLimits,
            [key]: val,
          };
          this.profileRenderer.setGraphLimits({ ...this.state.graphLimits });
        }
      });
    };

    bindGraphLimit('limitZMin', 'zMin_um');
    bindGraphLimit('limitZMax', 'zMax_um');
    bindGraphLimit('limitRMin', 'rMin_um');
    bindGraphLimit('limitRMax', 'rMax_um');

    this.bindSelect('selectGraphFitMode', (val) => {
      this.state.profileFitMode = val as GraphLimitFitMode;
      this.profileRenderer.setOptions({ fitMode: this.state.profileFitMode });
    });

    document.getElementById('btnResetGraphLimits')?.addEventListener('click', () => {
      this.state.graphLimits = { ...DEFAULT_GRAPH_LIMITS };
      this.state.profileFitMode = 'expand';
      this.setInputValue('limitZMin', String(DEFAULT_GRAPH_LIMITS.zMin_um));
      this.setInputValue('limitZMax', String(DEFAULT_GRAPH_LIMITS.zMax_um));
      this.setInputValue('limitRMin', String(DEFAULT_GRAPH_LIMITS.rMin_um));
      this.setInputValue('limitRMax', String(DEFAULT_GRAPH_LIMITS.rMax_um));
      this.setInputValue('selectGraphFitMode', 'expand');
      this.profileRenderer.setOptions({
        fitMode: 'expand',
        graphLimits: { ...DEFAULT_GRAPH_LIMITS },
      });
    });

    // Canvas Shared Toolbar Actions
    document.getElementById('btnOrientation')?.addEventListener('click', () => {
      this.state.orientation =
        this.state.orientation === 'vertical' ? 'horizontal' : 'vertical';
      this.profileRenderer.setOrientation(this.state.orientation);
      setText(
        'btnOrientationText',
        this.state.orientation === 'vertical' ? 'Vertical Z' : 'Horizontal Z',
      );
    });

    document.getElementById('btnResetView')?.addEventListener('click', () => {
      this.getActiveRenderer().resetView();
    });

    document.getElementById('btnExportPng')?.addEventListener('click', () => {
      void this.exportActiveCanvasPng();
    });

    document.getElementById('btnToggleTable')?.addEventListener('click', () => {
      const tab = this.state.activeTab;
      this.tableOpenByTab[tab] = !this.tableOpenByTab[tab];
      this.syncTableToggleButton(tab);
      this.refreshVisibleSummaryTable(tab);
    });

    // Tab 1 Sub-toolbar
    const chkCounterBeam = document.getElementById('toggleCounterBeam') as HTMLInputElement | null;
    chkCounterBeam?.addEventListener('change', () => {
      this.state.showCounterBeam = chkCounterBeam.checked;
      this.profileRenderer.setShowCounterBeam(this.state.showCounterBeam);
    });

    const chkProfileNozzle = document.getElementById('toggleProfileNozzle') as HTMLInputElement | null;
    chkProfileNozzle?.addEventListener('change', () => {
      this.state.showProfileNozzle = chkProfileNozzle.checked;
      this.profileRenderer.setShowNozzle(this.state.showProfileNozzle);
    });

    // Tab 2 Sub-toolbar
    this.bindSelect('selectTopDownMode', (val) => {
      this.state.tab2Mode = val as TopDownMode;
      this.topDownRenderer.setMode(this.state.tab2Mode);
    });

    const chkNozzleRings = document.getElementById('toggleNozzleRings') as HTMLInputElement | null;
    chkNozzleRings?.addEventListener('change', () => {
      this.state.showNozzleRings = chkNozzleRings.checked;
      this.topDownRenderer.setShowNozzleRings(this.state.showNozzleRings);
    });

    const orbitSlider = document.getElementById('sliderOrbitAngle') as HTMLInputElement | null;
    orbitSlider?.addEventListener('input', () => {
      const deg = Number.parseFloat(orbitSlider.value);
      this.state.orbitAngleDeg = Number.isFinite(deg) ? deg : 0;
      setText('textOrbitAngle', `${this.state.orbitAngleDeg.toFixed(1)}°`);
      this.topDownRenderer.setOrbitAngleDeg(this.state.orbitAngleDeg);
    });

    document
      .querySelectorAll<HTMLInputElement>('input[data-slice-plane]')
      .forEach((chk) => {
        chk.addEventListener('change', () => {
          const idx = Number.parseInt(chk.dataset.slicePlane ?? '', 10);
          if (idx >= 0 && idx < 6) {
            this.state.visibleSlicePlanes[idx] = chk.checked;
            this.topDownRenderer.setOptions({
              visiblePlanes: [...this.state.visibleSlicePlanes],
            });
          }
        });
      });

    // Tab 3 Sub-toolbar
    document
      .querySelectorAll<HTMLInputElement>('input[data-iso-contour]')
      .forEach((chk) => {
        chk.addEventListener('change', () => {
          const key = chk.dataset.isoContour as IsofluenceContourKey | undefined;
          if (key) {
            this.state.isofluenceVisibility[key] = chk.checked;
            this.isofluenceRenderer.setContourVisible(key, chk.checked);
          }
        });
      });

    // Tab 4 Sub-toolbar
    this.bindSelect('selectFluenceUnit', (val) => {
      this.state.fluenceUnitMode = val as FluenceUnitMode;
      this.fluenceRenderer.setUnitMode(this.state.fluenceUnitMode);
    });

    // Theme Toggle
    document.getElementById('btnToggleTheme')?.addEventListener('click', () => {
      this.theme = toggleTheme(this.theme);
      this.applyAppTheme(this.theme);
    });

    // Config Export / Import
    document.getElementById('btnExportConfig')?.addEventListener('click', () => {
      this.exportConfig();
    });
    document.getElementById('btnImportConfig')?.addEventListener('click', () => {
      document.getElementById('fileImportInput')?.click();
    });
    const fileInput = document.getElementById('fileImportInput') as HTMLInputElement | null;
    fileInput?.addEventListener('change', (e) => {
      void this.importConfigFile(e);
    });

    // Window resize redraw for safety heatmap
    window.addEventListener('resize', () => {
      if (this.state.stateMode === 'transition') {
        this.drawSafetyHeatmap();
      }
    });
  }

  private bindSafetyHeatmapScrubbing(): void {
    const canvas = document.getElementById('canvasSafetyHeatmap') as HTMLCanvasElement | null;
    if (!canvas) return;
    let dragging = false;

    const scrubFromEvent = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      if (rect.width <= 0) return;
      const pct = Math.max(
        0,
        Math.min(100, Math.round(((e.clientX - rect.left) / rect.width) * 100)),
      );
      this.setTransitionProgress(pct);
    };

    canvas.addEventListener('pointerdown', (e) => {
      dragging = true;
      canvas.setPointerCapture?.(e.pointerId);
      scrubFromEvent(e);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (dragging) scrubFromEvent(e);
    });
    canvas.addEventListener('pointerup', () => {
      dragging = false;
    });
    canvas.addEventListener('pointercancel', () => {
      dragging = false;
    });
  }

  private bindSelect(id: string, onChange: (val: string) => void): void {
    const el = document.getElementById(id) as HTMLSelectElement | null;
    el?.addEventListener('change', () => onChange(el.value));
  }

  private bindNumber(
    id: string,
    assign: (val: number) => void,
    isFloat = true,
  ): void {
    const el = document.getElementById(id) as HTMLInputElement | null;
    el?.addEventListener('input', () => {
      const parsed = isFloat
        ? Number.parseFloat(el.value)
        : Number.parseInt(el.value, 10);
      if (Number.isFinite(parsed)) {
        assign(parsed);
        void this.recalculate();
      }
    });
  }

  private bindOverride(
    id: string,
    prop:
      | 'm2Override'
      | 'pulseWidthOverride_fs'
      | 'focalLengthOverride_mm'
      | 'beamDiaOverride_mm'
      | 'transmissionOverride_pct'
      | 'focusRelZ_um'
      | 'nozzleApertureDia_mm'
      | 'nozzleWD_mm'
      | 'nozzleThick_mm'
      | 'maxAttackOverride_deg'
      | 'ablationThreshOverride_J_cm2',
  ): void {
    const el = document.getElementById(id) as HTMLInputElement | null;
    el?.addEventListener('input', () => {
      const trimmed = el.value.trim();
      if (trimmed === '') {
        this.state[prop] = null;
      } else {
        const parsed = Number.parseFloat(trimmed);
        this.state[prop] = Number.isFinite(parsed) ? parsed : null;
      }
      void this.recalculate();
    });
  }

  private setInputValue(id: string, value: string): void {
    const el = document.getElementById(id) as
      | HTMLInputElement
      | HTMLSelectElement
      | null;
    if (el) {
      el.value = value;
    }
  }

  private setTransitionProgress(pct: number, skipCompute = false): void {
    const clamped = Math.max(0, Math.min(100, pct));
    this.state.transitionProgress_pct = clamped;
    this.setInputValue('sliderProgress', String(Math.round(clamped)));
    setText('textProgress', `${clamped.toFixed(0)}%`);
    this.drawSafetyHeatmap();
    if (!skipCompute) {
      void this.recalculate();
    }
  }

  private syncTransitionControlsUI(): void {
    const isTransition = this.state.stateMode === 'transition';
    const startCol = document.getElementById('startStateCol') as HTMLFieldSetElement | null;
    if (startCol) {
      startCol.disabled = !isTransition;
    }

    const box = document.getElementById('transitionControlsBox');
    setHidden(box, !isTransition);
    if (isTransition) {
      // Unhidden BEFORE drawing heatmap so getBoundingClientRect() is non-zero
      this.drawSafetyHeatmap();
    }
  }

  private updateManualPanelsVisibility(): void {
    setHidden('manualLaserGroup', this.state.laserId !== 'MANUAL');
    setHidden('manualScanheadGroup', this.state.scanheadId !== 'MANUAL');
  }

  private updateDynamicLabels(): void {
    const scanhead = findScanheadPreset(this.state.scanheadId);
    const brand: ScanheadBrand = scanhead.isManual
      ? this.state.manualScanheadBrand
      : scanhead.brand;
    const isRound = this.state.holeType === 'round';

    if (isRound) {
      setText('labelScanSpeed', 'Scan Frequency');
      setText('unitScanSpeed', 'Hz');
      setText('labelEntranceDia', 'Entrance Diameter (µm)');
      setText('labelExitDia', 'Exit Diameter (µm)');
      setText(
        'labelScanheadDia',
        brand === 'Arges' ? 'Scan Radius (µm)' : 'Scan Diameter (µm)',
      );
      setText(
        'labelScanheadAOI',
        brand === 'Arges' ? 'Precession Amplitude (%)' : 'AOI (°)',
      );
      setText(
        'labelScanheadZ',
        brand === 'Arges'
          ? 'Z Focus (+ toward part, %)'
          : 'Z Focus (- toward part, µm)',
      );
    } else {
      setText('labelScanSpeed', 'Polyline Scan Speed');
      setText('unitScanSpeed', 'mm/sec');
      setText('labelEntranceDia', 'Entrance Width X/Y (µm)');
      setText('labelExitDia', 'Exit Width X/Y (µm)');
      setText('labelScanheadDia', 'Polyline Corner X/Y (µm)');
      setText('labelScanheadAOI', 'AOI at Corners (°)');
      setText('labelScanheadZ', 'Z Focus Position (µm)');
    }
  }

  private applyAppTheme(theme: ThemeMode): void {
    applyTheme(theme);
    setText('themeIcon', theme === 'dark' ? '☀️' : '🌙');
    const toggleBtn = document.getElementById('btnToggleTheme');
    if (toggleBtn) {
      toggleBtn.setAttribute('aria-pressed', theme === 'light' ? 'true' : 'false');
    }
    this.profileRenderer.setTheme(theme);
    this.topDownRenderer.setTheme(theme);
    this.isofluenceRenderer.setTheme(theme);
    this.fluenceRenderer.setTheme(theme);
    if (this.state.stateMode === 'transition') {
      this.drawSafetyHeatmap();
    }
  }

  private toggleAnimation(): void {
    if (this.isPlaying) {
      this.stopAnimation();
    } else {
      this.startAnimation();
    }
  }

  private startAnimation(): void {
    if (this.isPlaying) return;
    this.isPlaying = true;
    setText('btnPlayTransition', '⏸ Pause');
    let lastTime = performance.now();

    const step = (now: number) => {
      if (!this.isPlaying) return;
      const dt = (now - lastTime) / 1000;
      lastTime = now;
      const speedPctPerSec = 35;
      let next =
        this.state.transitionProgress_pct + speedPctPerSec * dt * this.playDirection;
      if (next >= 100) {
        next = 100;
        this.playDirection = -1;
      } else if (next <= 0) {
        next = 0;
        this.playDirection = 1;
      }
      this.setTransitionProgress(next, this.isAnimComputeInFlight);
      if (!this.isAnimComputeInFlight) {
        this.isAnimComputeInFlight = true;
        void this.recalculate().finally(() => {
          this.isAnimComputeInFlight = false;
        });
      }
      this.animFrameId = requestAnimationFrame(step);
    };

    this.animFrameId = requestAnimationFrame(step);
  }

  private stopAnimation(): void {
    const wasPlaying = this.isPlaying;
    this.isPlaying = false;
    this.isAnimComputeInFlight = false;
    setText('btnPlayTransition', '▶ Play');
    if (this.animFrameId !== null) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
    if (wasPlaying) {
      void this.recalculate();
    }
  }

  private drawSafetyHeatmap(): void {
    if (!this.lastResult) return;
    const canvas = document.getElementById('canvasSafetyHeatmap') as HTMLCanvasElement | null;
    if (!canvas) return;
    renderSafetyHeatmap(
      canvas,
      this.lastResult.output.transitionSweep,
      this.state.transitionProgress_pct,
      this.theme,
    );
  }

  private async recalculate(): Promise<void> {
    try {
      const result = await this.physicsClient.compute(toCalculatorInput(this.state));
      if (result === null) {
        return; // Superseded by newer compute request
      }
      this.lastResult = result;
      this.updateDomFromPhysics(result);

      this.profileRenderer.setOutput(result.output);
      this.topDownRenderer.setOutput(result.output);
      this.isofluenceRenderer.setOutput(result.output);
      this.fluenceRenderer.setOutput(result.output);

      if (this.state.stateMode === 'transition') {
        this.drawSafetyHeatmap();
      }
      this.refreshVisibleSummaryTable(this.state.activeTab);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Physics calculation error';
      showToast({
        id: 'physics-error',
        variant: 'error',
        title: 'Calculation Error',
        message: msg,
      });
    }
  }

  private updateDomFromPhysics(result: PhysicsComputeResult): void {
    const s = result.output.scalars;
    const laser = findLaserPreset(this.state.laserId);
    const scanhead = findScanheadPreset(this.state.scanheadId);
    const laserColor = laser.isManual ? this.state.manualLaserColor : laser.color;
    const scanheadColor = scanhead.isManual
      ? this.state.manualScanheadColor
      : scanhead.color;

    // Global warnings
    const warnings = getWarningMessages(s, laserColor, scanheadColor);
    const warnMismatchEl = document.getElementById('warnWavelengthMismatch');
    if (warnMismatchEl) {
      setHidden(warnMismatchEl, warnings.wavelengthWarning === null);
      if (warnings.wavelengthWarning) {
        warnMismatchEl.textContent = `⚠️ ${warnings.wavelengthWarning}`;
      }
    }

    const warnArgesEl = document.getElementById('warnArgesSquare');
    if (warnArgesEl) {
      setHidden(warnArgesEl, warnings.argesSquareWarning === null);
      if (warnings.argesSquareWarning) {
        warnArgesEl.textContent = warnings.argesSquareWarning;
      }
    }

    // Status bar readouts & badges
    const attackDeg = (s.attackAngle_rad * 180) / Math.PI;
    setText('readoutCurrentAngle', `${formatMetricNumber(attackDeg, 2)}°`);
    setText('readoutCurrentZShift', formatMetricNumber(s.zShift_um, 0, 'µm'));
    setText('readoutCurrentRadius', formatMetricNumber(s.effectiveScanRadius_um, 1, 'µm'));
    setText(
      'badgeEngineBackend',
      `Engine: ${result.backend.toUpperCase()} (${result.computeMs.toFixed(1)} ms)`,
    );

    const badgeNozzle = document.getElementById('badgeNozzleClearance');
    if (badgeNozzle) {
      if (s.nozzleClipping) {
        const beamDiaMm =
          (Math.max(s.exitAperture1MaxR_um, s.exitAperture2MaxR_um) * 2) / 1000;
        badgeNozzle.className = 'status-badge error';
        badgeNozzle.textContent = `❌ Nozzle Clipping (${beamDiaMm.toFixed(2)} mm beam)`;
      } else {
        badgeNozzle.className = 'status-badge success';
        badgeNozzle.textContent = '✓ Nozzle Clearance OK';
      }
    }

    const badgeWall = document.getElementById('badgeWallClearance');
    if (badgeWall) {
      if (s.wallOvercut) {
        badgeWall.className = 'status-badge warning';
        badgeWall.textContent = `⚠️ Wall Overcut (+${s.maxOvercut_um.toFixed(1)} µm)`;
      } else {
        badgeWall.className = 'status-badge success';
        badgeWall.textContent = '✓ Hole Wall Within Limit';
      }
    }

    // Inline Z lookup + all 18 Optical & Process Metrics
    const ablatedZStr = formatAblatedSpotAtZ(s.ablatedSpotAtLookupZ_um);
    setText('readoutAblatedAtZ', ablatedZStr);
    setText('metricAblatedSpotAtZ', ablatedZStr);

    setText('metricPulseEnergyBase', formatMetricNumber(s.pulseEnergyBase_uJ, 2, 'µJ'));
    setText('metricPulseEnergyOutput', formatMetricNumber(s.pulseEnergyOutput_uJ, 2, 'µJ'));
    setText('metricAveragePower', formatMetricNumber(s.avgPower_W, 2, 'W'));
    setText('metricPeakPower', formatMetricNumber(s.peakPower_MW, 2, 'MW'));
    setText('metricSpotSize', formatMetricNumber(s.spotSize_um, 2, 'µm'));
    setText('metricRayleighRange', formatMetricNumber(s.rayleighRange_um, 2, 'µm'));
    setText('metricPeakFluence', formatMetricNumber(s.peakFluence_J_cm2, 2, 'J/cm²'));
    setText('metricPeakIrradiance', formatMetricNumber(s.peakIrradiance_TW_cm2, 2, 'TW/cm²'));
    setText('metricAverageIrradiance', formatMetricNumber(s.avgIrradiance_MW_cm2, 2, 'MW/cm²'));
    setText('metricScanSpeed', formatMetricNumber(s.scanSpeed_mm_s, 2, 'mm/s'));
    setText('metricSpotOverlap', `${formatMetricNumber(s.spotOverlap_pct, 2)}%`);
    setText('metricAblatedSpot', formatMetricNumber(s.ablatedSpotAt0_um, 2, 'µm'));
    setText('metricThresholdR', formatMetricNumber(s.thresholdR, 4));
    setText('metricEnergyAboveThresh', `${formatMetricNumber(s.energyAboveThresh_pct, 2)}%`);
    setText('metricBeamDivergence', formatMetricNumber(s.beamDivergence_mrad, 2, 'mrad'));
    setText('metricExitAperture1MaxR', formatMetricNumber(s.exitAperture1MaxR_um, 1, 'µm'));
    setText('metricExitAperture2MaxR', formatMetricNumber(s.exitAperture2MaxR_um, 1, 'µm'));
  }

  private async exportActiveCanvasPng(): Promise<void> {
    const activeTab = this.state.activeTab;
    const ok = await this.getActiveRenderer().exportPNG(
      `laser-trepanning-${activeTab}.png`,
    );
    if (ok) {
      showToast({
        variant: 'success',
        message: `Exported ${activeTab} chart PNG.`,
        durationMs: 3000,
      });
    } else {
      showToast({
        variant: 'error',
        message: 'Could not export chart PNG.',
      });
    }
  }

  private exportConfig(): void {
    const json = serializeAppState(this.state);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `trepan-config-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);

    showToast({
      variant: 'success',
      message: 'Configuration exported as JSON.',
      durationMs: 3000,
    });
  }

  private async importConfigFile(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const validation = parseAndValidateConfigJson(text);
      if (!validation.ok) {
        showToast({
          variant: 'error',
          title: 'Invalid Configuration File',
          message: validation.errors.slice(0, 3).join('; '),
          durationMs: 7000,
        });
        return;
      }

      this.stopAnimation();
      this.state = validation.state;
      this.syncInputsWithState();
      this.syncRenderersFromState();
      await this.recalculate();

      showToast({
        variant: 'success',
        message: 'Configuration imported and validated.',
        durationMs: 3500,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to read file';
      showToast({
        variant: 'error',
        title: 'Import Error',
        message: msg,
      });
    } finally {
      input.value = '';
    }
  }

  private syncRenderersFromState(): void {
    this.profileRenderer.setOptions({
      orientation: this.state.orientation,
      showCounterBeam: this.state.showCounterBeam,
      showNozzle: this.state.showProfileNozzle,
      fitMode: this.state.profileFitMode,
      graphLimits: { ...this.state.graphLimits },
    });

    this.topDownRenderer.setOptions({
      mode: this.state.tab2Mode,
      holeType: this.state.holeType,
      showNozzleRings: this.state.showNozzleRings,
      visiblePlanes: [...this.state.visibleSlicePlanes],
    });
    this.topDownRenderer.setOrbitAngleDeg(this.state.orbitAngleDeg);

    this.isofluenceRenderer.setOptions({
      zFromFocusLookup_um: this.state.zFromFocusLookup_um,
      visibleContours: { ...this.state.isofluenceVisibility },
    });

    this.fluenceRenderer.setUnitMode(this.state.fluenceUnitMode);
  }

  public syncInputsWithState(): void {
    const s = this.state;

    this.setInputValue('selectLaser', s.laserId);
    this.setInputValue('selectScanhead', s.scanheadId);
    this.setInputValue('selectHoleType', s.holeType);
    this.setInputValue('selectDivergenceMode', s.divergenceMode);

    this.setInputValue('inputManualLaserWavelength', String(s.manualLaserWavelength_um));
    this.setInputValue('selectManualLaserColor', s.manualLaserColor);
    this.setInputValue('inputManualLaserPulseWidth', String(s.manualLaserPulseWidth_fs));

    this.setInputValue('selectManualScanheadBrand', s.manualScanheadBrand);
    this.setInputValue('selectManualScanheadColor', s.manualScanheadColor);
    this.setInputValue('inputManualScanheadFocalLength', String(s.manualScanheadFocalLength_mm));
    this.setInputValue('inputManualScanheadBeamDia', String(s.manualScanheadBeamDia_mm));
    this.setInputValue('inputManualScanheadTransmission', String(s.manualScanheadTransmission_pct));
    this.setInputValue('inputManualScanheadScanSpeed', String(s.manualScanheadScanSpeed_Hz));
    this.setInputValue('inputManualScanheadM2', String(s.manualScanheadM2));
    this.setInputValue('inputManualScanheadMaxAttack', String(s.manualScanheadMaxAttack_deg));
    this.setInputValue('inputManualScanheadMaxZTravel', String(s.manualScanheadMaxZTravel_um));

    this.setInputValue('inputBasePower', String(s.basePower_W));
    this.setInputValue('inputBaseRepRate', String(s.baseRepRate_kHz));
    this.setInputValue('inputDivider', String(s.divider));
    this.setInputValue('inputAttenuator', String(s.attenuator_pct));
    this.setInputValue('inputScanSpeed', String(s.scanSpeed_Hz));

    this.setInputValue('inputEntranceDia', String(s.entranceDia_um));
    this.setInputValue('inputExitDia', String(s.exitDia_um));
    this.setInputValue('inputMaterialThick', String(s.materialThick_um));
    this.setInputValue('inputPartSurfaceZ', String(s.partSurface_Z_um));

    const radioSingle = document.getElementById('radioSingleState') as HTMLInputElement | null;
    const radioTransition = document.getElementById('radioTransitionState') as HTMLInputElement | null;
    if (radioSingle) radioSingle.checked = s.stateMode === 'single';
    if (radioTransition) radioTransition.checked = s.stateMode === 'transition';

    this.setInputValue('inputStartDia', String(s.startDia_um));
    this.setInputValue('inputStartAOI', String(s.startAOI));
    this.setInputValue('inputStartZ', String(s.startZ));
    this.setInputValue('inputEndDia', String(s.endDia_um));
    this.setInputValue('inputEndAOI', String(s.endAOI));
    this.setInputValue('inputEndZ', String(s.endZ));

    this.setInputValue('sliderProgress', String(s.transitionProgress_pct));
    setText('textProgress', `${s.transitionProgress_pct.toFixed(0)}%`);

    this.setInputValue('inputJobScaling', String(s.jobScaling));
    this.setInputValue('inputNodeScaling', String(s.nodeScaling));

    this.setInputValue('selectDirection', s.direction);
    this.setInputValue('inputPhase1', String(s.phase1_deg));
    this.setInputValue('inputRotation1', String(s.rotation1_deg));
    this.setInputValue('inputPhase2', String(s.phase2_deg));
    this.setInputValue('inputRotation2', String(s.rotation2_deg));
    this.setInputValue('inputDistXYRotation', String(s.distXYRotation_deg));

    const setOverrideVal = (id: string, val: number | null) => {
      this.setInputValue(id, val === null ? '' : String(val));
    };
    setOverrideVal('overrideM2', s.m2Override);
    setOverrideVal('overridePulseWidth', s.pulseWidthOverride_fs);
    setOverrideVal('overrideFocalLength', s.focalLengthOverride_mm);
    setOverrideVal('overrideBeamDia', s.beamDiaOverride_mm);
    setOverrideVal('overrideTransmission', s.transmissionOverride_pct);
    setOverrideVal('overrideFocusRelZ', s.focusRelZ_um);
    setOverrideVal('overrideNozzleDia', s.nozzleApertureDia_mm);
    setOverrideVal('overrideNozzleWD', s.nozzleWD_mm);
    setOverrideVal('overrideNozzleThick', s.nozzleThick_mm);
    setOverrideVal('overrideMaxAttack', s.maxAttackOverride_deg);
    setOverrideVal('overrideAblationThresh', s.ablationThreshOverride_J_cm2);

    this.setInputValue('inputZFromFocus', String(s.zFromFocusLookup_um));
    this.setInputValue('isoZFromFocusMirror', String(s.zFromFocusLookup_um));
    this.setInputValue('limitZMin', String(s.graphLimits.zMin_um));
    this.setInputValue('limitZMax', String(s.graphLimits.zMax_um));
    this.setInputValue('limitRMin', String(s.graphLimits.rMin_um));
    this.setInputValue('limitRMax', String(s.graphLimits.rMax_um));
    this.setInputValue('selectGraphFitMode', s.profileFitMode);

    setText(
      'btnOrientationText',
      s.orientation === 'vertical' ? 'Vertical Z' : 'Horizontal Z',
    );
    const chkCounterBeam = document.getElementById('toggleCounterBeam') as HTMLInputElement | null;
    if (chkCounterBeam) chkCounterBeam.checked = s.showCounterBeam;
    const chkProfileNozzle = document.getElementById('toggleProfileNozzle') as HTMLInputElement | null;
    if (chkProfileNozzle) chkProfileNozzle.checked = s.showProfileNozzle;

    this.setInputValue('selectTopDownMode', s.tab2Mode);
    const chkNozzleRings = document.getElementById('toggleNozzleRings') as HTMLInputElement | null;
    if (chkNozzleRings) chkNozzleRings.checked = s.showNozzleRings;
    this.setInputValue('sliderOrbitAngle', String(s.orbitAngleDeg));
    setText('textOrbitAngle', `${s.orbitAngleDeg.toFixed(1)}°`);

    document
      .querySelectorAll<HTMLInputElement>('input[data-slice-plane]')
      .forEach((chk) => {
        const idx = Number.parseInt(chk.dataset.slicePlane ?? '', 10);
        if (idx >= 0 && idx < 6) {
          chk.checked = s.visibleSlicePlanes[idx];
        }
      });

    document
      .querySelectorAll<HTMLInputElement>('input[data-iso-contour]')
      .forEach((chk) => {
        const key = chk.dataset.isoContour as IsofluenceContourKey | undefined;
        if (key && key in s.isofluenceVisibility) {
          chk.checked = s.isofluenceVisibility[key];
        }
      });

    this.setInputValue('selectFluenceUnit', s.fluenceUnitMode);

    this.updateManualPanelsVisibility();
    this.syncTransitionControlsUI();
    this.updateDynamicLabels();
    this.tabsController?.activateTab(s.activeTab, { focus: false, notify: true });
  }
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  const boot = () => {
    (window as unknown as { app?: TrepanningCalculatorApp }).app =
      new TrepanningCalculatorApp();
  };
  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
}
