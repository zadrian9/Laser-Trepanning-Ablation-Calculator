/**
 * Native <dialog closedby="any"> controller with feature-detected
 * backdrop light-dismiss fallback when closedBy is unsupported.
 */

export interface DialogHandle {
  open(): void;
  close(): void;
  destroy(): void;
}

export function supportsNativeClosedBy(dialog?: HTMLDialogElement): boolean {
  if (typeof HTMLDialogElement !== 'undefined' && 'closedBy' in HTMLDialogElement.prototype) {
    return true;
  }
  return Boolean(dialog && 'closedBy' in dialog);
}

export function bindDialog(
  dialog: HTMLDialogElement,
  openTriggers: readonly HTMLElement[] = [],
  closeTriggers: readonly HTMLElement[] = [],
): DialogHandle {
  if (!dialog.hasAttribute('closedby')) {
    dialog.setAttribute('closedby', 'any');
  }

  const open = (): void => {
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) {
        dialog.showModal();
      }
    } else {
      dialog.setAttribute('open', '');
      dialog.open = true;
    }
  };

  const close = (): void => {
    if (typeof dialog.close === 'function') {
      if (dialog.open) {
        dialog.close();
      }
    } else {
      dialog.removeAttribute('open');
      dialog.open = false;
    }
  };

  const onOpenClick = (): void => open();
  const onCloseClick = (): void => close();

  for (const trigger of openTriggers) {
    trigger.addEventListener('click', onOpenClick);
  }
  for (const trigger of closeTriggers) {
    trigger.addEventListener('click', onCloseClick);
  }

  const useFallbackLightDismiss = !supportsNativeClosedBy(dialog);
  let pointerDownOnBackdrop = false;

  const isClickOutsideSurface = (e: MouseEvent): boolean => {
    const surface = dialog.firstElementChild as HTMLElement | null;
    if (surface && typeof surface.getBoundingClientRect === 'function') {
      const rect = surface.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        return (
          e.clientX < rect.left ||
          e.clientX > rect.right ||
          e.clientY < rect.top ||
          e.clientY > rect.bottom
        );
      }
    }
    return e.target === dialog;
  };

  const onPointerDown = (e: PointerEvent): void => {
    pointerDownOnBackdrop = e.target === dialog && isClickOutsideSurface(e);
  };

  const onBackdropClick = (e: MouseEvent): void => {
    if (e.target === dialog && (pointerDownOnBackdrop || isClickOutsideSurface(e))) {
      close();
    }
    pointerDownOnBackdrop = false;
  };

  if (useFallbackLightDismiss) {
    dialog.addEventListener('pointerdown', onPointerDown);
    dialog.addEventListener('click', onBackdropClick);
  }

  return {
    open,
    close,
    destroy: () => {
      for (const trigger of openTriggers) {
        trigger.removeEventListener('click', onOpenClick);
      }
      for (const trigger of closeTriggers) {
        trigger.removeEventListener('click', onCloseClick);
      }
      if (useFallbackLightDismiss) {
        dialog.removeEventListener('pointerdown', onPointerDown);
        dialog.removeEventListener('click', onBackdropClick);
      }
    },
  };
}
