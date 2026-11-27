# Laser Trepanning & Ablation Calculator

A client-side, offline-first Progressive Web App (PWA) for diffraction-limited Gaussian beam optics, laser-material ablation thresholds, and 3D precession trepanning kinematics. All calculations run locally in the browser using an **AssemblyScript WebAssembly** (`f64`) physics kernel inside a **Dedicated Module Web Worker**—requiring no backend server.

**Live App (GitHub Pages):** `https://zadrian9.github.io/Laser-Trepanning-Ablation-Calculator/`

---

## Key Features

### Client-Side WASM & Web Worker Physics Engine
- **AssemblyScript WebAssembly Kernel (`assembly/engine.ts` → `engine.wasm`)**: Double-precision (`f64`) vectorized solver running off the main thread in a Dedicated Module Web Worker (`src/worker/physics.worker.ts`) with zero-copy Transferable `Float64Array` buffers.
- **Automatic TypeScript Fallback**: Seamlessly falls back to an identical pure-TypeScript engine (`src/math/`) if WebAssembly or Web Workers are restricted.
- **Single-Flight Worker Dispatch & Sweep Caching**: Rapid slider scrubbing and Play animations skip redundant 101-state sweep work via a worker-side parameter cache and `computeFast()` ABI (~2.8 ms/frame).

### Optical & Trepanning Capabilities
- **Equipment Presets & Overrides**:
  - **Lasers**: Charmilles Femto FlexiPulse (IR / Green), Light Conversion Carbide (IR / Green), Coherent Monaco, and Manual Input (custom wavelength/color).
  - **Scanheads**: Arges Elephant v2 IR, Scanlab PrecSYS (IR / Green), and Manual Input (Scanlab or Arges coordinate conventions).
- **Diffraction-Limited Optics**: Pulse energy, average/peak power, $1/e^2$ spot size, Rayleigh range, peak fluence, peak/average irradiance, XY-scaled scan speed & spot overlap, ablated spot diameter at focus and at arbitrary `Z From Focus`, % energy above threshold, and a **Beam Divergence toggle** (`Current (Accurate)` vs. `Legacy (Excel v5.3)`).
- **2-Plane Nozzle Clipping & Tapered Wall Overcut**: Evaluates 2,003 orbit angles across 8 Z-planes (both top and tip nozzle exit apertures, focus plane, and workpiece depths `Top` → `Bottom`) including XY & precession ellipticity/rotation (`Phase1/2`, `Rotation1/2`, `Dist XY Rotation`, `CW`/`CCW`).
- **State Transition Mode & Safety Heatmap**: Smoothly interpolates `Start State` → `End State` (`0%`–`100%`) with interactive scrubber, Play/Pause animation, and a 101-state Safety Heatmap flagging intermediate nozzle clipping or wall overcut.

### 4-Tab Interactive High-DPI Canvas Suite
1. **Trepanning Cross-Section**: Target hole taper, 2-plane nozzle bore geometry with clipping alerts, $1/e^2$ beam waist & ablation envelopes, Vertical/Horizontal Z toggle, Graph Limit Expansion, and optional 180° opposite counter-beam.
2. **Multi-Plane 3D Path & Contours**: Switchable **Beam Center Path**, **1/e² Contour**, **Ablation Contour**, or **All Overlays** across 6 workpiece depth slices, optional nozzle aperture rings, and an interactive orbit angle scrubber.
3. **Isofluence Lines**: Axial propagation contours ($w(z)$, $0.135\text{–}0.9\,I_0$, Ablation Threshold, Thermal Damage $I/64$) with live `Z From Focus` indicator.
4. **Focus Energy Distribution**: Radial Gaussian profile highlighting ablated vs. sub-threshold energy, toggleable between Normalized and $\text{J/cm}^2$ units.

All charts support mouse/touch pan & zoom, hover coordinate crosshairs, accessible numeric summary tables, and PNG image export.

### Modern Web Platform & Offline PWA
- **Installable & Offline-Ready**: Configured via `vite-plugin-pwa` (Workbox precaching of HTML, CSS, JS, Worker, and `.wasm`), `navigator.install()` / `beforeinstallprompt` install flow, and non-intrusive update prompts.
- **FOUC-Free Light/Dark Theme**: Follows OS preference by default with a persistent light/dark override synced across UI and canvases.
- **Portable Configuration**: Export and import validated JSON presets locally; built-in native `<dialog>` Technical & Dimensions Guide with inline SVG schematics.

---

## Local Development

**Prerequisites:** Node.js 20+ and npm.

```sh
# Install dependencies
npm install

# Compile AssemblyScript WASM kernel (src/wasm/engine.wasm)
npm run build:wasm

# Start Vite dev server
npm run dev

# Run TypeScript typecheck, unit tests, and production build
npm run typecheck
npm test
npm run build

# Preview production build locally (including Service Worker)
npm run preview
```

To regenerate PWA PNG icons from `public/icon.svg`:

```sh
npm run build:icons
```

---

## GitHub Pages Deployment

This repository includes [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml), which automatically builds the WASM binary, runs `typecheck` and unit tests, compiles the static bundle (`base: './'`), and deploys `dist/` to GitHub Pages on every push to `main`.

To enable hosting on GitHub:
1. Open your repository **Settings → Pages**.
2. Under **Build and deployment → Source**, select **GitHub Actions**.

---

## Project Structure

```text
├── .github/workflows/deploy.yml   # GitHub Pages CI/CD workflow
├── assembly/engine.ts             # AssemblyScript WASM physics kernel (f64)
├── public/                        # SVG & generated PWA PNG icons
├── scripts/generate-icons.mjs     # SVG-to-PNG PWA icon generator
├── src/
│   ├── app.ts                     # Main app orchestrator & reactive UI state
│   ├── data/presets.ts            # Laser, scanhead & default state presets
│   ├── math/                      # TypeScript fallback physics engine
│   ├── pwa/install.ts             # PWA install & Workbox SW update handler
│   ├── render/                    # High-DPI Canvas renderers (4 tabs + base)
│   ├── state/schema.ts            # Strict JSON config import/export validation
│   ├── types/physics.ts           # Canonical ABI & Float64Array buffer layout
│   ├── ui/                        # Dialogs, tabs, theme, toasts & DOM helpers
│   ├── wasm/loader.ts             # Pure WebAssembly loader & ABI wrapper
│   └── worker/                    # Dedicated Web Worker & single-flight client
├── tests/                         # Vitest unit, render, schema & E2E suites
├── index.html
├── style.css
└── vite.config.ts
```

---

## License

This project is licensed under the GNU Affero General Public License v3.0. See [LICENSE](LICENSE) for details.
