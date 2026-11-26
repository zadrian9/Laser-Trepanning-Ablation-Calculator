/**
 * Accessible tablist controller using native focusgroup="tablist"
 * with a roving-tabindex keyboard polyfill (ArrowLeft/ArrowRight/Home/End).
 */

import { setHidden } from './domHelpers.ts';

export interface TabControllerOptions {
  tablist: HTMLElement;
  initialTab: string;
  onTabChange?: (tabId: string) => void;
  doc?: Document;
}

export interface TabController {
  getActiveTab(): string;
  activateTab(tabId: string, opts?: { focus?: boolean; notify?: boolean }): void;
  destroy(): void;
}

export function createTabController(options: TabControllerOptions): TabController {
  const { tablist, onTabChange } = options;
  const doc = options.doc ?? tablist.ownerDocument ?? document;

  tablist.setAttribute('role', 'tablist');
  if (!tablist.hasAttribute('focusgroup')) {
    tablist.setAttribute('focusgroup', 'tablist');
  }

  const tabs = Array.from(
    tablist.querySelectorAll<HTMLElement>('[role="tab"][data-tab]'),
  );

  let activeTabId = options.initialTab;

  const getPanelForTab = (tab: HTMLElement): HTMLElement | null => {
    const panelId = tab.getAttribute('aria-controls');
    return panelId ? doc.getElementById(panelId) : null;
  };

  const applySelection = (
    targetId: string,
    { focus = false, notify = true }: { focus?: boolean; notify?: boolean } = {},
  ): void => {
    const targetTab = tabs.find((t) => t.dataset.tab === targetId) ?? tabs[0];
    if (!targetTab) return;
    const resolvedId = targetTab.dataset.tab ?? targetId;
    const changed = resolvedId !== activeTabId;
    activeTabId = resolvedId;

    for (const tab of tabs) {
      const isSelected = tab === targetTab;
      tab.setAttribute('aria-selected', isSelected ? 'true' : 'false');
      tab.tabIndex = isSelected ? 0 : -1;
      tab.classList.toggle('active', isSelected);

      const panel = getPanelForTab(tab);
      if (panel) {
        setHidden(panel, !isSelected);
        panel.classList.toggle('active', isSelected);
      }
    }

    if (focus) {
      targetTab.focus();
    }
    if (notify && (changed || true)) {
      onTabChange?.(resolvedId);
    }
  };

  const handleClick = (e: Event): void => {
    const target = (e.target as Element | null)?.closest<HTMLElement>('[role="tab"][data-tab]');
    if (!target || !tablist.contains(target)) return;
    const tabId = target.dataset.tab;
    if (tabId) {
      applySelection(tabId, { focus: false, notify: true });
    }
  };

  const handleKeyDown = (e: KeyboardEvent): void => {
    const current = (e.target as Element | null)?.closest<HTMLElement>('[role="tab"][data-tab]');
    if (!current || !tablist.contains(current) || tabs.length === 0) return;

    const currentIndex = tabs.indexOf(current);
    if (currentIndex === -1) return;

    let nextIndex = -1;
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        nextIndex = (currentIndex + 1) % tabs.length;
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
        break;
      case 'Home':
        nextIndex = 0;
        break;
      case 'End':
        nextIndex = tabs.length - 1;
        break;
      default:
        return;
    }

    e.preventDefault();
    const nextTab = tabs[nextIndex];
    const nextId = nextTab?.dataset.tab;
    if (nextId) {
      applySelection(nextId, { focus: true, notify: true });
    }
  };

  tablist.addEventListener('click', handleClick);
  tablist.addEventListener('keydown', handleKeyDown);

  // Initialize without firing redundant external notification unless requested
  applySelection(activeTabId, { focus: false, notify: false });

  return {
    getActiveTab: () => activeTabId,
    activateTab: (tabId, opts = {}) => {
      applySelection(tabId, {
        focus: opts.focus ?? false,
        notify: opts.notify ?? true,
      });
    },
    destroy: () => {
      tablist.removeEventListener('click', handleClick);
      tablist.removeEventListener('keydown', handleKeyDown);
    },
  };
}
