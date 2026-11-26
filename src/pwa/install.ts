/**
 * PWA installation controller (navigator.install() with beforeinstallprompt fallback)
 * and Workbox Service Worker registration with non-blocking update toast.
 */

import { registerSW } from 'virtual:pwa-register';
import { setHidden } from '../ui/domHelpers.ts';
import { showToast } from '../ui/toast.ts';

export interface PwaInstallHandle {
  destroy(): void;
}

export function isRunningStandalone(): boolean {
  try {
    return (
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(display-mode: standalone)').matches
    );
  } catch {
    return false;
  }
}

export function setupPwaInstall(
  installButton: HTMLButtonElement | null,
): PwaInstallHandle {
  if (!installButton) {
    return { destroy: () => {} };
  }

  let deferredPrompt: BeforeInstallPromptEvent | null = null;
  const hasNativeInstall =
    typeof navigator !== 'undefined' && typeof navigator.install === 'function';

  // Hidden by default; reveal immediately only if navigator.install() is supported
  // and app is not already running standalone.
  setHidden(installButton, !(hasNativeInstall && !isRunningStandalone()));

  const onBeforeInstallPrompt = (e: BeforeInstallPromptEvent): void => {
    e.preventDefault();
    deferredPrompt = e;
    if (!isRunningStandalone()) {
      setHidden(installButton, false);
    }
  };

  const onAppInstalled = (): void => {
    deferredPrompt = null;
    setHidden(installButton, true);
    showToast({
      id: 'pwa-installed',
      variant: 'success',
      message: 'App installed for offline use.',
      durationMs: 4000,
    });
  };

  const onInstallClick = async (): Promise<void> => {
    if (typeof navigator !== 'undefined' && typeof navigator.install === 'function') {
      try {
        await navigator.install();
        setHidden(installButton, true);
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          return;
        }
        if (deferredPrompt) {
          await promptWithDeferred();
        }
      }
      return;
    }

    if (deferredPrompt) {
      await promptWithDeferred();
    }
  };

  const promptWithDeferred = async (): Promise<void> => {
    const promptEvent = deferredPrompt;
    if (!promptEvent) return;
    deferredPrompt = null;
    try {
      await promptEvent.prompt();
      const choice = await promptEvent.userChoice;
      if (choice.outcome === 'accepted') {
        setHidden(installButton, true);
      }
    } catch {
      // Ignore user cancellation / prompt errors
    }
  };

  window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
  window.addEventListener('appinstalled', onAppInstalled);
  installButton.addEventListener('click', onInstallClick);

  return {
    destroy: () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
      window.removeEventListener('appinstalled', onAppInstalled);
      installButton.removeEventListener('click', onInstallClick);
    },
  };
}

export function registerPwaServiceWorker(): void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return;
  }
  try {
    const updateSW = registerSW({
      immediate: false,
      onNeedRefresh() {
        showToast({
          id: 'pwa-update',
          variant: 'info',
          title: 'Update Available',
          message: 'A new version of Laser Trepanning Calculator is ready.',
          durationMs: 0,
          action: {
            label: 'Reload',
            onClick: () => {
              void updateSW(true);
            },
          },
        });
      },
      onOfflineReady() {
        showToast({
          id: 'pwa-offline',
          variant: 'success',
          message: 'Ready for offline use.',
          durationMs: 4000,
        });
      },
    });
  } catch {
    // Ignore SW registration failures in non-SW environments
  }
}
