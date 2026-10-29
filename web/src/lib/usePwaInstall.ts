import { useEffect, useRef, useState, useCallback } from 'react';

/** The browser's `beforeinstallprompt` event (Chrome/Edge/Samsung Internet). */
interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
  prompt(): Promise<void>;
}

/**
 * Hook that captures the `beforeinstallprompt` event and exposes:
 * - `canInstall`: true when the browser supports in-app install AND the app isn't already installed.
 * - `isInstalled`: true when running as an installed PWA (standalone/fullscreen/twa).
 * - `triggerInstall()`: shows the browser's native install dialog.
 */
export function usePwaInstall() {
  const deferredPrompt = useRef<BeforeInstallPromptEvent | null>(null);
  const [canInstall, setCanInstall] = useState(false);
  const [isInstalled, setIsInstalled] = useState(false);

  useEffect(() => {
    // Check if already running in standalone (installed) mode
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      window.matchMedia('(display-mode: fullscreen)').matches ||
      (navigator as unknown as { standalone?: boolean }).standalone === true;
    setIsInstalled(isStandalone);

    if (isStandalone) return; // no need to listen for install prompt

    const onPrompt = (e: Event) => {
      e.preventDefault(); // prevent the mini-infobar
      deferredPrompt.current = e as BeforeInstallPromptEvent;
      setCanInstall(true);
    };

    const onInstalled = () => {
      deferredPrompt.current = null;
      setCanInstall(false);
      setIsInstalled(true);
    };

    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const triggerInstall = useCallback(async () => {
    const prompt = deferredPrompt.current;
    if (!prompt) return false;
    await prompt.prompt();
    const choice = await prompt.userChoice;
    if (choice.outcome === 'accepted') {
      deferredPrompt.current = null;
      setCanInstall(false);
      setIsInstalled(true);
      return true;
    }
    return false;
  }, []);

  return { canInstall, isInstalled, triggerInstall };
}
