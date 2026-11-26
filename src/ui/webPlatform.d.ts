/**
 * Ambient TypeScript declarations for modern / emerging Web Platform APIs
 * not yet included in TypeScript's built-in lib.dom.d.ts.
 */

export {};

declare global {
  interface BeforeInstallPromptEvent extends Event {
    readonly platforms: readonly string[];
    readonly userChoice: Promise<{
      outcome: 'accepted' | 'dismissed';
      platform: string;
    }>;
    prompt(): Promise<void>;
  }

  interface Navigator {
    install?: (installUrl?: string, manifestId?: string) => Promise<unknown>;
  }

  interface WindowEventMap {
    beforeinstallprompt: BeforeInstallPromptEvent;
    appinstalled: Event;
  }

  interface HTMLDialogElement {
    closedBy?: 'any' | 'closerequest' | 'none' | string;
  }

  interface HTMLElement {
    focusgroup?: string;
  }
}
