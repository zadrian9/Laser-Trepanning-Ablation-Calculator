import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('virtual:pwa-register', () => ({
  registerSW: vi.fn(() => vi.fn()),
}));

import {
  formatAblatedSpotAtZ,
  formatCrosshairReadout,
  formatMetricNumber,
  getWarningMessages,
} from '../src/app.ts';
import { DEFAULT_CALCULATOR_INPUT } from '../src/data/presets.ts';
import { orbitDegreesToIndex } from '../src/render/topDownCanvas.ts';
import {
  DEFAULT_STATE,
  cloneAppState,
  parseAndValidateConfigJson,
  serializeAppState,
  toCalculatorInput,
  validateAppState,
} from '../src/state/schema.ts';
import {
  createEl,
  populateSelect,
  replaceChildrenSafe,
  setHidden,
  setText,
} from '../src/ui/domHelpers.ts';
import { bindDialog } from '../src/ui/modals.ts';
import { createTabController } from '../src/ui/tabs.ts';
import { applyTheme, getSavedTheme, toggleTheme } from '../src/ui/theme.ts';
import { ToastManager } from '../src/ui/toast.ts';

// ---------------------------------------------------------------------------
// Minimal Mock DOM for Node Vitest Environment
// ---------------------------------------------------------------------------
class MockEvent {
  type: string;
  target: unknown = null;
  defaultPrevented = false;
  key = '';
  clientX = 0;
  clientY = 0;

  constructor(type: string, init: Partial<MockEvent> = {}) {
    this.type = type;
    Object.assign(this, init);
  }

  preventDefault(): void {
    this.defaultPrevented = true;
  }
}

class MockClassList {
  private set = new Set<string>();
  constructor(initial = '') {
    for (const token of initial.split(/\s+/).filter(Boolean)) {
      this.set.add(token);
    }
  }
  add(...tokens: string[]): void {
    for (const t of tokens) this.set.add(t);
  }
  remove(...tokens: string[]): void {
    for (const t of tokens) this.set.delete(t);
  }
  toggle(token: string, force?: boolean): boolean {
    if (force === undefined) {
      if (this.set.has(token)) {
        this.set.delete(token);
        return false;
      }
      this.set.add(token);
      return true;
    }
    if (force) {
      this.set.add(token);
      return true;
    }
    this.set.delete(token);
    return false;
  }
  contains(token: string): boolean {
    return this.set.has(token);
  }
  toString(): string {
    return [...this.set].join(' ');
  }
}

class MockNode {
  nodeType: number;
  ownerDocument: MockDocument | null = null;
  parentNode: MockElement | null = null;
  childNodes: MockNode[] = [];
  private _text = '';

  constructor(nodeType: number, text = '') {
    this.nodeType = nodeType;
    this._text = text;
  }

  get textContent(): string {
    if (this.nodeType === 3) return this._text;
    return this.childNodes.map((c) => c.textContent).join('');
  }

  set textContent(val: string) {
    const str = String(val ?? '');
    if (this.nodeType === 3) {
      this._text = str;
      this.childNodes = [];
    } else {
      this._text = '';
      this.childNodes = str.length > 0 ? [new MockNode(3, str)] : [];
    }
  }

  get firstChild(): MockNode | null {
    return this.childNodes[0] ?? null;
  }

  appendChild<T extends MockNode>(node: T): T {
    if (node.parentNode) {
      node.parentNode.removeChild(node);
    }
    node.parentNode = this as unknown as MockElement;
    this.childNodes.push(node);
    return node;
  }

  removeChild<T extends MockNode>(node: T): T {
    const idx = this.childNodes.indexOf(node);
    if (idx >= 0) {
      this.childNodes.splice(idx, 1);
      node.parentNode = null;
    }
    return node;
  }

  remove(): void {
    if (this.parentNode) {
      this.parentNode.removeChild(this);
    }
  }
}

class MockElement extends MockNode {
  tagName: string;
  attrs = new Map<string, string>();
  dataset: Record<string, string> = {};
  classList = new MockClassList();
  style: Record<string, string> = {};
  hidden = false;
  tabIndex = 0;
  value = '';
  selected = false;
  open = false;
  focused = false;
  popoverCalls = { show: 0, hide: 0 };
  modalCalls = { showModal: 0, close: 0 };
  rect = { left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 };
  private listeners = new Map<string, Set<(e: MockEvent) => void>>();

  constructor(tagName: string, doc: MockDocument) {
    super(1);
    this.tagName = tagName.toUpperCase();
    this.ownerDocument = doc;
  }

  get id(): string {
    return this.attrs.get('id') ?? '';
  }

  set id(val: string) {
    this.setAttribute('id', val);
  }

  get className(): string {
    return this.classList.toString();
  }

  set className(val: string) {
    this.classList = new MockClassList(val);
  }

  get children(): MockElement[] {
    return this.childNodes.filter((n): n is MockElement => n instanceof MockElement);
  }

  get firstElementChild(): MockElement | null {
    return this.children[0] ?? null;
  }

  setAttribute(name: string, val: string): void {
    this.attrs.set(name, val);
    if (name === 'hidden') this.hidden = true;
    if (name === 'class') this.className = val;
    if (name.startsWith('data-')) {
      const camel = name
        .slice(5)
        .replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
      this.dataset[camel] = val;
    }
  }

  getAttribute(name: string): string | null {
    return this.attrs.get(name) ?? null;
  }

  hasAttribute(name: string): boolean {
    return this.attrs.has(name);
  }

  removeAttribute(name: string): void {
    this.attrs.delete(name);
    if (name === 'hidden') this.hidden = false;
    if (name.startsWith('data-')) {
      const camel = name
        .slice(5)
        .replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
      delete this.dataset[camel];
    }
  }

  replaceChildren(...nodes: (MockNode | string)[]): void {
    this.childNodes = [];
    for (const n of nodes) {
      if (typeof n === 'string') {
        this.appendChild(new MockNode(3, n));
      } else {
        this.appendChild(n);
      }
    }
  }

  addEventListener(type: string, cb: (e: MockEvent) => void): void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(cb);
  }

  removeEventListener(type: string, cb: (e: MockEvent) => void): void {
    this.listeners.get(type)?.delete(cb);
  }

  dispatchEvent(event: MockEvent): void {
    if (!event.target) event.target = this;
    let cur: MockElement | null = this;
    while (cur) {
      const set = cur.listeners.get(event.type);
      if (set) {
        for (const cb of set) cb(event);
      }
      cur = cur.parentNode;
    }
  }

  contains(other: MockNode | null): boolean {
    let cur: MockNode | null = other;
    while (cur) {
      if (cur === this) return true;
      cur = cur.parentNode;
    }
    return false;
  }

  closest(selector: string): MockElement | null {
    let cur: MockElement | null = this;
    while (cur) {
      if (matchesSimpleSelector(cur, selector)) return cur;
      cur = cur.parentNode;
    }
    return null;
  }

  querySelectorAll(selector: string): MockElement[] {
    const out: MockElement[] = [];
    const visit = (el: MockElement) => {
      for (const child of el.children) {
        if (matchesSimpleSelector(child, selector)) {
          out.push(child);
        }
        visit(child);
      }
    };
    visit(this);
    return out;
  }

  focus(): void {
    this.focused = true;
    if (this.ownerDocument) {
      this.ownerDocument.activeElement = this;
    }
  }

  getBoundingClientRect() {
    return this.rect;
  }

  showPopover(): void {
    this.popoverCalls.show += 1;
  }

  hidePopover(): void {
    this.popoverCalls.hide += 1;
  }

  showModal(): void {
    this.modalCalls.showModal += 1;
    this.open = true;
    this.setAttribute('open', '');
  }

  close(): void {
    this.modalCalls.close += 1;
    this.open = false;
    this.removeAttribute('open');
  }
}

function matchesSimpleSelector(el: MockElement, selector: string): boolean {
  if (selector === '[role="tab"][data-tab]') {
    return el.getAttribute('role') === 'tab' && el.hasAttribute('data-tab');
  }
  return false;
}

class MockDocument {
  body: MockElement;
  documentElement: MockElement;
  activeElement: MockElement | null = null;
  private elementsById = new Map<string, MockElement>();

  constructor() {
    this.documentElement = new MockElement('html', this);
    this.body = new MockElement('body', this);
    this.documentElement.appendChild(this.body);
  }

  createElement(tag: string): MockElement {
    return new MockElement(tag, this);
  }

  createTextNode(text: string): MockNode {
    return new MockNode(3, text);
  }

  registerById(id: string, el: MockElement): void {
    el.id = id;
    this.elementsById.set(id, el);
  }

  getElementById(id: string): MockElement | null {
    if (this.elementsById.has(id)) {
      return this.elementsById.get(id)!;
    }
    const stack: MockElement[] = [this.documentElement];
    while (stack.length > 0) {
      const cur = stack.pop()!;
      if (cur.id === id) return cur;
      stack.push(...cur.children);
    }
    return null;
  }
}

// ---------------------------------------------------------------------------
// 1. Strict JSON Schema Validation & Prototype-Pollution Rejection
// ---------------------------------------------------------------------------
describe('State Schema & Strict JSON Config Validation', () => {
  it('round-trips DEFAULT_STATE through serializeAppState and parseAndValidateConfigJson', () => {
    const json = serializeAppState(DEFAULT_STATE);
    const res = parseAndValidateConfigJson(json);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state).toEqual(DEFAULT_STATE);
    expect(toCalculatorInput(res.state)).toEqual(DEFAULT_CALCULATOR_INPUT);
    expect(Object.keys(toCalculatorInput(res.state)).sort()).toEqual(
      Object.keys(DEFAULT_CALCULATOR_INPUT).sort(),
    );
  });

  it('accepts configs omitting optional UI fields while rejecting unknown keys', () => {
    const minimal = cloneAppState(DEFAULT_STATE) as unknown as Record<string, unknown>;
    delete minimal.showProfileNozzle;
    delete minimal.profileFitMode;
    const okRes = validateAppState(minimal);
    expect(okRes.ok).toBe(true);

    const withExtra = { ...cloneAppState(DEFAULT_STATE), unexpectedKey: 123 };
    const badRes = validateAppState(withExtra);
    expect(badRes.ok).toBe(false);
    if (!badRes.ok) {
      expect(badRes.errors.some((e) => e.includes('unexpectedKey'))).toBe(true);
    }
  });

  it('rejects __proto__, constructor, and prototype pollution payloads cleanly', () => {
    const base = JSON.parse(serializeAppState(DEFAULT_STATE)) as Record<string, unknown>;
    const pollutedJson = JSON.stringify(base).slice(0, -1) +
      ',"__proto__":{"polluted":true},"constructor":{"prototype":{"p2":true}}}';

    const res = parseAndValidateConfigJson(pollutedJson);
    expect(res.ok).toBe(false);
    expect(({} as { polluted?: unknown }).polluted).toBeUndefined();
    expect(({} as { p2?: unknown }).p2).toBeUndefined();

    // Also test direct validateAppState on an object with own __proto__ property
    const rawWithProto = JSON.parse(pollutedJson) as unknown;
    const directRes = validateAppState(rawWithProto);
    expect(directRes.ok).toBe(false);
  });

  it('rejects prototype pollution nested inside graphLimits or isofluenceVisibility', () => {
    const rawJson = serializeAppState(DEFAULT_STATE).replace(
      '"zMin_um": -500',
      '"__proto__": {"x": 1}, "zMin_um": -500',
    );
    const res = parseAndValidateConfigJson(rawJson);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.errors.some((e) => e.includes('__proto__'))).toBe(true);
    }
  });

  it('rejects invalid roots, empty/oversized JSON, bad enums, and out-of-range numbers', () => {
    expect(parseAndValidateConfigJson('').ok).toBe(false);
    expect(parseAndValidateConfigJson('{bad json').ok).toBe(false);
    expect(parseAndValidateConfigJson('null').ok).toBe(false);
    expect(parseAndValidateConfigJson('[]').ok).toBe(false);
    expect(parseAndValidateConfigJson('"hello"').ok).toBe(false);
    expect(parseAndValidateConfigJson('123').ok).toBe(false);
    expect(parseAndValidateConfigJson('x'.repeat(300_000)).ok).toBe(false);

    const badEnum = { ...cloneAppState(DEFAULT_STATE), laserId: 'UNKNOWN_LASER' };
    expect(validateAppState(badEnum).ok).toBe(false);

    const badBrand = { ...cloneAppState(DEFAULT_STATE), manualScanheadBrand: 'Other' };
    expect(validateAppState(badBrand).ok).toBe(false);

    const badAtten = { ...cloneAppState(DEFAULT_STATE), attenuator_pct: 120 };
    expect(validateAppState(badAtten).ok).toBe(false);

    const badDivider = { ...cloneAppState(DEFAULT_STATE), divider: 0 };
    expect(validateAppState(badDivider).ok).toBe(false);

    const badThresh = { ...cloneAppState(DEFAULT_STATE), ablationThreshOverride_J_cm2: 0 };
    expect(validateAppState(badThresh).ok).toBe(false);

    const badM2 = { ...cloneAppState(DEFAULT_STATE), m2Override: 0.8 };
    expect(validateAppState(badM2).ok).toBe(false);

    const badNaN = { ...cloneAppState(DEFAULT_STATE), basePower_W: Number.NaN };
    expect(validateAppState(badNaN).ok).toBe(false);

    const badSlices = { ...cloneAppState(DEFAULT_STATE), visibleSlicePlanes: [true, false] };
    expect(validateAppState(badSlices).ok).toBe(false);
  });

  it('preserves null overrides and normalizes inverted graphLimits', () => {
    const inverted = cloneAppState(DEFAULT_STATE);
    inverted.m2Override = null;
    inverted.graphLimits = {
      zMin_um: 1200,
      zMax_um: -400,
      rMin_um: 100,
      rMax_um: -50,
    };
    const res = validateAppState(inverted);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.m2Override).toBeNull();
    expect(res.state.graphLimits).toEqual({
      zMin_um: -400,
      zMax_um: 1200,
      rMin_um: -50,
      rMax_um: 100,
    });
  });
});

// ---------------------------------------------------------------------------
// 2. Tabs (focusgroup + Roving Tabindex Polyfill) & Dialog (closedby + Fallback)
// ---------------------------------------------------------------------------
describe('TabsController (focusgroup + keyboard polyfill) & bindDialog', () => {
  it('supports click, ArrowRight/ArrowLeft wrap-around, Home, and End with hidden panels', () => {
    const doc = new MockDocument();
    const tablist = doc.createElement('div');
    const tabIds = ['profile', 'topdown', 'isofluence', 'fluence'];
    const tabs: MockElement[] = [];
    const panels: MockElement[] = [];

    for (const id of tabIds) {
      const btn = doc.createElement('button');
      btn.setAttribute('role', 'tab');
      btn.setAttribute('data-tab', id);
      btn.setAttribute('aria-controls', `panel-${id}`);
      tablist.appendChild(btn);
      tabs.push(btn);

      const panel = doc.createElement('div');
      doc.registerById(`panel-${id}`, panel);
      doc.body.appendChild(panel);
      panels.push(panel);
    }
    doc.body.appendChild(tablist);

    const changed: string[] = [];
    const ctrl = createTabController({
      tablist: tablist as unknown as HTMLElement,
      initialTab: 'profile',
      onTabChange: (id) => changed.push(id),
      doc: doc as unknown as Document,
    });

    expect(tablist.getAttribute('focusgroup')).toBe('tablist');
    expect(ctrl.getActiveTab()).toBe('profile');
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
    expect(tabs[0].tabIndex).toBe(0);
    expect(tabs[1].tabIndex).toBe(-1);
    expect(panels[0].hidden).toBe(false);
    expect(panels[1].hidden).toBe(true);

    // ArrowRight from tab 0 -> tab 1
    tabs[0].dispatchEvent(new MockEvent('keydown', { key: 'ArrowRight' }));
    expect(ctrl.getActiveTab()).toBe('topdown');
    expect(tabs[1].tabIndex).toBe(0);
    expect(tabs[1].focused).toBe(true);
    expect(panels[1].hidden).toBe(false);
    expect(panels[0].hidden).toBe(true);

    // End -> last tab (fluence)
    tabs[1].dispatchEvent(new MockEvent('keydown', { key: 'End' }));
    expect(ctrl.getActiveTab()).toBe('fluence');
    expect(panels[3].hidden).toBe(false);

    // ArrowRight wraps to first tab (profile)
    tabs[3].dispatchEvent(new MockEvent('keydown', { key: 'ArrowRight' }));
    expect(ctrl.getActiveTab()).toBe('profile');

    // ArrowLeft wraps to last tab (fluence)
    tabs[0].dispatchEvent(new MockEvent('keydown', { key: 'ArrowLeft' }));
    expect(ctrl.getActiveTab()).toBe('fluence');

    // Home -> first tab (profile)
    tabs[3].dispatchEvent(new MockEvent('keydown', { key: 'Home' }));
    expect(ctrl.getActiveTab()).toBe('profile');

    expect(changed).toEqual(['topdown', 'fluence', 'profile', 'fluence', 'profile']);
    ctrl.destroy();
  });

  it('binds native dialog open/close and backdrop fallback when closedBy is unsupported', () => {
    const doc = new MockDocument();
    const dialog = doc.createElement('dialog');
    const card = doc.createElement('div');
    card.rect = { left: 100, right: 500, top: 100, bottom: 400, width: 400, height: 300 };
    dialog.appendChild(card);

    const openBtn = doc.createElement('button');
    const closeBtn = doc.createElement('button');
    doc.body.appendChild(dialog);

    const handle = bindDialog(
      dialog as unknown as HTMLDialogElement,
      [openBtn as unknown as HTMLElement],
      [closeBtn as unknown as HTMLElement],
    );

    expect(dialog.getAttribute('closedby')).toBe('any');

    openBtn.dispatchEvent(new MockEvent('click'));
    expect(dialog.open).toBe(true);
    expect(dialog.modalCalls.showModal).toBe(1);

    // Click inside modal card should NOT close
    dialog.dispatchEvent(new MockEvent('pointerdown', { target: card, clientX: 200, clientY: 200 }));
    dialog.dispatchEvent(new MockEvent('click', { target: card, clientX: 200, clientY: 200 }));
    expect(dialog.open).toBe(true);

    // Click outside card on dialog backdrop SHOULD close
    dialog.dispatchEvent(new MockEvent('pointerdown', { target: dialog, clientX: 10, clientY: 10 }));
    dialog.dispatchEvent(new MockEvent('click', { target: dialog, clientX: 10, clientY: 10 }));
    expect(dialog.open).toBe(false);
    expect(dialog.modalCalls.close).toBe(1);

    handle.open();
    expect(dialog.open).toBe(true);
    closeBtn.dispatchEvent(new MockEvent('click'));
    expect(dialog.open).toBe(false);
    handle.destroy();
  });
});

// ---------------------------------------------------------------------------
// 3. Toast Notifications (popover="manual") & Theme Persistence
// ---------------------------------------------------------------------------
describe('ToastManager & Theme Helpers', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows, runs action buttons, auto-dismisses, and closes popover container', () => {
    const doc = new MockDocument();
    const container = doc.createElement('div');
    doc.registerById('toastRegion', container);
    doc.body.appendChild(container);

    const manager = new ToastManager(
      container as unknown as HTMLElement,
      doc as unknown as Document,
    );
    let actionClicked = false;
    const id = manager.show({
      title: 'Update Available',
      message: 'New version ready <script>xss</script>',
      variant: 'info',
      durationMs: 3000,
      action: {
        label: 'Reload',
        onClick: () => {
          actionClicked = true;
        },
      },
    });

    expect(manager.getActiveCount()).toBe(1);
    expect(container.popoverCalls.show).toBe(1);
    expect(container.getAttribute('data-open')).toBe('true');

    // XSS payload stored strictly as textContent
    const toastEl = container.children[0];
    expect(toastEl.textContent).toContain('<script>xss</script>');

    // Clicking action triggers callback and dismisses toast
    const actionsEl = toastEl.children[1];
    const reloadBtn = actionsEl.children[0];
    reloadBtn.dispatchEvent(new MockEvent('click'));
    expect(actionClicked).toBe(true);
    expect(manager.getActiveCount()).toBe(0);
    expect(container.popoverCalls.hide).toBe(1);

    // Auto-dismiss timer
    manager.show({ id, message: 'Temporary', durationMs: 2000 });
    expect(manager.getActiveCount()).toBe(1);
    vi.advanceTimersByTime(2000);
    expect(manager.getActiveCount()).toBe(0);
  });

  it('persists and toggles theme safely even when storage throws', () => {
    const doc = new MockDocument();
    const map = new Map<string, string>();
    const storage = {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => {
        map.set(k, v);
      },
    };

    expect(getSavedTheme(storage, true)).toBe('light');
    applyTheme('dark', doc.documentElement as unknown as HTMLElement, storage);
    expect(doc.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(doc.documentElement.style.colorScheme).toBe('dark');
    expect(getSavedTheme(storage, true)).toBe('dark');

    const next = toggleTheme('dark', doc.documentElement as unknown as HTMLElement, storage);
    expect(next).toBe('light');
    expect(doc.documentElement.getAttribute('data-theme')).toBe('light');
    expect(doc.documentElement.style.colorScheme).toBe('light');

    const throwingStorage = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    };
    expect(getSavedTheme(throwingStorage, false)).toBe('dark');
    expect(() =>
      applyTheme('light', doc.documentElement as unknown as HTMLElement, throwingStorage),
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 4. Safe DOM Helpers & Static Security / Cleanup Audit
// ---------------------------------------------------------------------------
describe('Safe DOM Helpers & Static Hygiene Audit', () => {
  it('renders XSS payloads as literal textContent without HTML parsing', () => {
    const doc = new MockDocument();
    const select = doc.createElement('select');
    const xssPayload = '<img src=x onerror="alert(1)">';
    populateSelect(
      select as unknown as HTMLSelectElement,
      [{ value: 'v1', label: xssPayload }],
      'v1',
    );
    expect(select.children.length).toBe(1);
    expect(select.children[0].textContent).toBe(xssPayload);
    expect(select.children[0].children.length).toBe(0);

    const div = createEl(
      'div',
      { className: 'box', text: '<script>alert(1)</script>' },
      [],
      doc as unknown as Document,
    ) as unknown as MockElement;
    expect(div.children.length).toBe(0);
    expect(div.textContent).toBe('<script>alert(1)</script>');

    setText(div as unknown as HTMLElement, '<b>safe</b>');
    expect(div.textContent).toBe('<b>safe</b>');

    setHidden(div as unknown as HTMLElement, true);
    expect(div.hidden).toBe(true);
    setHidden(div as unknown as HTMLElement, false);
    expect(div.hidden).toBe(false);

    replaceChildrenSafe(div as unknown as Element, ['plain text']);
    expect(div.textContent).toBe('plain text');
  });

  it('contains zero innerHTML/outerHTML/insertAdjacentHTML/document.write/alert in src/ and zero $...$ in index.html', () => {
    const rootDir = path.resolve(__dirname, '..');
    const srcDir = path.join(rootDir, 'src');

    const walkTs = (dir: string): string[] => {
      const files: string[] = [];
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          files.push(...walkTs(full));
        } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
          files.push(full);
        }
      }
      return files;
    };

    const tsFiles = walkTs(srcDir);
    expect(tsFiles.length).toBeGreaterThan(5);

    const forbiddenPatterns = [
      /\.innerHTML\b/,
      /\.outerHTML\b/,
      /insertAdjacentHTML\b/,
      /document\.write\b/,
      /\balert\s*\(/,
    ];

    for (const file of tsFiles) {
      const content = fs.readFileSync(file, 'utf8');
      const stripped = content
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');
      for (const pat of forbiddenPatterns) {
        expect(stripped, `Forbidden pattern ${pat} in ${file}`).not.toMatch(pat);
      }
    }

    const html = fs.readFileSync(path.join(rootDir, 'index.html'), 'utf8');
    expect(html).not.toMatch(/\$[^$]+\$/);
    expect(html).not.toContain('./public/');
    expect(html).toContain('src="./src/app.ts"');
    expect(html.match(/<main\b/g)?.length).toBe(1);
    expect(html.match(/<\/main>/g)?.length).toBe(1);
  });

  it('confirms all 7 superseded starter .js files have been deleted', () => {
    const rootDir = path.resolve(__dirname, '..');
    const deletedFiles = [
      'src/app.js',
      'src/data/presets.js',
      'src/math/optics.js',
      'src/math/trepanning.js',
      'src/render/profileCanvas.js',
      'src/render/topDownCanvas.js',
      'src/render/fluenceCanvas.js',
    ];
    for (const rel of deletedFiles) {
      expect(fs.existsSync(path.join(rootDir, rel)), `${rel} should be deleted`).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// 5. Metrics Formatting, Warnings & Orbit Index Helpers
// ---------------------------------------------------------------------------
describe('Metrics Formatting, Warnings & Orbit Helpers', () => {
  it('formats finite numbers, -0, and NaN cleanly', () => {
    expect(formatMetricNumber(-0, 2, 'µm')).toBe('0.00 µm');
    expect(formatMetricNumber(12.3456, 2, 'W')).toBe('12.35 W');
    expect(formatMetricNumber(Number.NaN, 2, 'µm')).toBe('--');
    expect(formatAblatedSpotAtZ(Number.NaN)).toBe('Below Threshold');
    expect(formatAblatedSpotAtZ(23.436)).toBe('23.44 µm');
    expect(formatCrosshairReadout(null)).toBe('Hover plot for coordinates');
    expect(
      formatCrosshairReadout({
        screenX: 0,
        screenY: 0,
        worldX: 10,
        worldY: 20,
        labelX: 'R: 10.0 µm',
        labelY: 'Z: 20.0 µm',
      }),
    ).toBe('R: 10.0 µm  |  Z: 20.0 µm');
  });

  it('emits exact Arges + Square Hole and Wavelength Mismatch warnings', () => {
    const w1 = getWarningMessages(
      { wavelengthMismatch: true, argesSquareWarning: true },
      'Green',
      'IR',
    );
    expect(w1.argesSquareWarning).toBe('Square holes not supported for Arges!');
    expect(w1.wavelengthWarning).toContain('Green');
    expect(w1.wavelengthWarning).toContain('IR');

    const w2 = getWarningMessages(
      { wavelengthMismatch: false, argesSquareWarning: false },
      'IR',
      'IR',
    );
    expect(w2.argesSquareWarning).toBeNull();
    expect(w2.wavelengthWarning).toBeNull();
  });

  it('maps orbit degrees to 0..2000 contour indices', () => {
    expect(orbitDegreesToIndex(0)).toBe(0);
    expect(orbitDegreesToIndex(180)).toBe(1000);
    expect(orbitDegreesToIndex(360)).toBe(2000);
  });
});
