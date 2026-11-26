/**
 * Safe DOM manipulation helpers using textContent and explicit element creation.
 */

export interface SelectOption {
  value: string;
  label: string;
}

export interface CreateElOptions {
  className?: string;
  text?: string;
  attrs?: Record<string, string>;
}

export function resolveElement<T extends HTMLElement = HTMLElement>(
  elOrId: T | string | null | undefined,
  doc?: Document,
): T | null {
  if (!elOrId) return null;
  if (typeof elOrId === 'string') {
    const targetDoc = doc ?? (typeof document !== 'undefined' ? document : undefined);
    return (targetDoc?.getElementById(elOrId) as T | null) ?? null;
  }
  return elOrId;
}

export function replaceChildrenSafe(
  parent: Element,
  nodes: readonly (Node | string)[],
): void {
  if (typeof parent.replaceChildren === 'function') {
    parent.replaceChildren(...nodes);
    return;
  }
  while (parent.firstChild) {
    parent.removeChild(parent.firstChild);
  }
  const doc =
    parent.ownerDocument ?? (typeof document !== 'undefined' ? document : undefined);
  if (!doc) return;
  for (const node of nodes) {
    if (typeof node === 'string') {
      parent.appendChild(doc.createTextNode(node));
    } else {
      parent.appendChild(node);
    }
  }
}

export function createEl<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  opts: CreateElOptions = {},
  children: readonly (Node | string)[] = [],
  doc?: Document,
): HTMLElementTagNameMap[K] {
  const targetDoc = doc ?? document;
  const el = targetDoc.createElement(tag);
  if (opts.className) {
    el.className = opts.className;
  }
  if (opts.text !== undefined) {
    el.textContent = opts.text;
  }
  if (opts.attrs) {
    for (const [k, v] of Object.entries(opts.attrs)) {
      el.setAttribute(k, v);
    }
  }
  for (const child of children) {
    if (typeof child === 'string') {
      el.appendChild(targetDoc.createTextNode(child));
    } else {
      el.appendChild(child);
    }
  }
  return el;
}

export function populateSelect(
  select: HTMLSelectElement | string | null,
  options: readonly SelectOption[],
  selectedValue?: string,
): void {
  const el = resolveElement<HTMLSelectElement>(select);
  if (!el) return;
  const doc = el.ownerDocument ?? document;
  const optionNodes: HTMLOptionElement[] = options.map((opt) => {
    const optionEl = doc.createElement('option');
    optionEl.value = opt.value;
    optionEl.textContent = opt.label;
    if (selectedValue !== undefined && opt.value === selectedValue) {
      optionEl.selected = true;
    }
    return optionEl;
  });
  replaceChildrenSafe(el, optionNodes);
  if (selectedValue !== undefined) {
    el.value = selectedValue;
  }
}

export function setText(
  elOrId: HTMLElement | string | null | undefined,
  text: string,
): void {
  const el = resolveElement(elOrId);
  if (!el) return;
  el.textContent = text;
}

export function setHidden(
  elOrId: HTMLElement | string | null | undefined,
  hidden: boolean,
): void {
  const el = resolveElement(elOrId);
  if (!el) return;
  el.hidden = hidden;
  if (hidden) {
    el.setAttribute('hidden', '');
  } else {
    el.removeAttribute('hidden');
  }
}
