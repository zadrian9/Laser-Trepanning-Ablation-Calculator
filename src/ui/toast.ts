/**
 * Non-blocking dismissible toast notifications built on popover="manual".
 * Falls back cleanly via data-open / hidden when showPopover() is unavailable.
 */

import { createEl } from './domHelpers.ts';

export type ToastVariant = 'info' | 'success' | 'warning' | 'error';

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastOptions {
  id?: string;
  title?: string;
  message: string;
  variant?: ToastVariant;
  durationMs?: number;
  action?: ToastAction;
}

interface ActiveToastRecord {
  id: string;
  element: HTMLElement;
  timerId: ReturnType<typeof setTimeout> | null;
  durationMs: number;
  remainingMs: number;
  startedAt: number;
}

export class ToastManager {
  private container: HTMLElement | null;
  private doc: Document;
  private active = new Map<string, ActiveToastRecord>();
  private nextSeq = 0;

  constructor(container?: HTMLElement | null, doc: Document = document) {
    this.doc = doc;
    this.container = container ?? doc.getElementById('toastRegion');
  }

  private ensureContainer(): HTMLElement {
    if (this.container) return this.container;
    const existing = this.doc.getElementById('toastRegion');
    if (existing) {
      this.container = existing;
      return existing;
    }
    const created = createEl(
      'div',
      {
        className: 'toast-region',
        attrs: {
          id: 'toastRegion',
          popover: 'manual',
          role: 'status',
          'aria-live': 'polite',
        },
      },
      [],
      this.doc,
    );
    this.doc.body?.appendChild(created);
    this.container = created;
    return created;
  }

  private openContainer(container: HTMLElement): void {
    container.removeAttribute('hidden');
    container.hidden = false;
    container.setAttribute('data-open', 'true');
    const popEl = container as HTMLElement & { showPopover?: () => void };
    if (typeof popEl.showPopover === 'function') {
      try {
        popEl.showPopover();
      } catch {
        // Ignore if already open or unsupported in environment
      }
    }
  }

  private closeContainer(container: HTMLElement): void {
    container.removeAttribute('data-open');
    const popEl = container as HTMLElement & { hidePopover?: () => void };
    if (typeof popEl.hidePopover === 'function') {
      try {
        popEl.hidePopover();
      } catch {
        // Ignore if already closed
      }
    }
  }

  show(options: ToastOptions): string {
    const container = this.ensureContainer();
    const id = options.id ?? `toast-${++this.nextSeq}`;
    if (this.active.has(id)) {
      this.dismiss(id);
    }

    const variant: ToastVariant = options.variant ?? 'info';
    const durationMs =
      options.durationMs !== undefined ? Math.max(0, options.durationMs) : 5000;

    const item = createEl(
      'div',
      {
        className: `toast-item toast-${variant}`,
        attrs: {
          'data-toast-id': id,
          role: variant === 'error' ? 'alert' : 'status',
        },
      },
      [],
      this.doc,
    );

    const content = createEl('div', { className: 'toast-content' }, [], this.doc);
    if (options.title) {
      content.appendChild(
        createEl('div', { className: 'toast-title', text: options.title }, [], this.doc),
      );
    }
    content.appendChild(
      createEl('div', { className: 'toast-message', text: options.message }, [], this.doc),
    );
    item.appendChild(content);

    const actions = createEl('div', { className: 'toast-actions' }, [], this.doc);
    if (options.action) {
      const actionBtn = createEl(
        'button',
        {
          className: 'btn btn-sm btn-primary toast-action-btn',
          text: options.action.label,
          attrs: { type: 'button' },
        },
        [],
        this.doc,
      );
      actionBtn.addEventListener('click', () => {
        options.action?.onClick();
        this.dismiss(id);
      });
      actions.appendChild(actionBtn);
    }

    const closeBtn = createEl(
      'button',
      {
        className: 'toast-close-btn',
        text: '×',
        attrs: {
          type: 'button',
          'aria-label': 'Dismiss notification',
        },
      },
      [],
      this.doc,
    );
    closeBtn.addEventListener('click', () => this.dismiss(id));
    actions.appendChild(closeBtn);
    item.appendChild(actions);

    const record: ActiveToastRecord = {
      id,
      element: item,
      timerId: null,
      durationMs,
      remainingMs: durationMs,
      startedAt: Date.now(),
    };

    const startTimer = () => {
      if (record.remainingMs <= 0) return;
      if (record.timerId !== null) clearTimeout(record.timerId);
      record.startedAt = Date.now();
      record.timerId = setTimeout(() => this.dismiss(id), record.remainingMs);
    };

    const pauseTimer = () => {
      if (record.timerId !== null) {
        clearTimeout(record.timerId);
        record.timerId = null;
        const elapsed = Date.now() - record.startedAt;
        record.remainingMs = Math.max(50, record.remainingMs - elapsed);
      }
    };

    if (durationMs > 0) {
      item.addEventListener('pointerenter', pauseTimer);
      item.addEventListener('focusin', pauseTimer);
      item.addEventListener('pointerleave', startTimer);
      item.addEventListener('focusout', startTimer);
      startTimer();
    }

    container.appendChild(item);
    this.active.set(id, record);
    this.openContainer(container);
    return id;
  }

  dismiss(id: string): void {
    const rec = this.active.get(id);
    if (!rec) return;
    if (rec.timerId !== null) {
      clearTimeout(rec.timerId);
      rec.timerId = null;
    }
    rec.element.remove();
    this.active.delete(id);

    if (this.active.size === 0 && this.container) {
      this.closeContainer(this.container);
    }
  }

  clearAll(): void {
    for (const id of [...this.active.keys()]) {
      this.dismiss(id);
    }
  }

  getActiveCount(): number {
    return this.active.size;
  }
}

let defaultToastManager: ToastManager | null = null;

export function getDefaultToastManager(): ToastManager {
  if (!defaultToastManager) {
    defaultToastManager = new ToastManager();
  }
  return defaultToastManager;
}

export function showToast(options: ToastOptions): string {
  return getDefaultToastManager().show(options);
}

export function dismissToast(id: string): void {
  getDefaultToastManager().dismiss(id);
}
