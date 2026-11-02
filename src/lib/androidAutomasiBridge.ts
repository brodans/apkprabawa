// ─────────────────────────────────────────────────────────────────────────────
// androidAutomasiBridge — jembatan ke fitur native Android untuk automasi.
//
// Dipasang melalui WebView.addJavascriptInterface("AndroidPrabawaAutomasi")
// di MainActivity.kt (via tools/patch-android-native.mts).
//
// Fallback chain untuk notifikasi:
//   1. window.AndroidPrabawaAutomasi.showNotification() — Android native
//   2. @tauri-apps/plugin-notification               — Linux / desktop Tauri
//   3. Web Notification API                           — browser / WebView fallback
//   4. console.info                                   — last resort
// ─────────────────────────────────────────────────────────────────────────────

// @tauri-apps/plugin-notification diimport secara dinamis di dalam fungsi
// agar tidak error di lingkungan non-Tauri (browser biasa).

interface AndroidPrabawaAutomasiInterface {
  startForegroundService(title: string, content: string): void;
  stopForegroundService(): void;
  showNotification(title: string, message: string): boolean;
  requestBatteryOptimizationExemption(): void;
  isIgnoringBatteryOptimizations(): boolean;
}

declare global {
  interface Window {
    AndroidPrabawaAutomasi?: AndroidPrabawaAutomasiInterface;
  }
}

export function isAndroid(): boolean {
  if (typeof window === 'undefined') return false;
  return Boolean(window.AndroidPrabawaAutomasi);
}

const isTauriRuntime = (): boolean =>
  typeof window !== 'undefined' && Boolean((window as any).__TAURI_INTERNALS__);

export function startAndroidForegroundService(title: string, content: string): void {
  try {
    window.AndroidPrabawaAutomasi?.startForegroundService(title, content);
  } catch (e) {
    console.warn('[AutomasiBridge] startForegroundService error:', e);
  }
}

export function stopAndroidForegroundService(): void {
  try {
    window.AndroidPrabawaAutomasi?.stopForegroundService();
  } catch (e) {
    console.warn('[AutomasiBridge] stopForegroundService error:', e);
  }
}

export async function kirimNotifikasiNative(title: string, message: string): Promise<void> {
  // ── 1. Android native bridge ────────────────────────────────────────────────
  if (isAndroid()) {
    try {
      const ok = window.AndroidPrabawaAutomasi!.showNotification(title, message);
      if (ok) return;
    } catch {
      // fallthrough
    }
  }

  // ── 2. Tauri plugin-notification (Linux AppImage / desktop) ────────────────
  if (isTauriRuntime()) {
    try {
      const { isPermissionGranted, requestPermission, sendNotification } =
        await import('@tauri-apps/plugin-notification');
      let granted = await isPermissionGranted();
      if (!granted) {
        const perm = await requestPermission();
        granted = perm === 'granted';
      }
      if (granted) {
        sendNotification({ title, body: message });
        return;
      }
    } catch {
      // fallthrough — plugin belum init atau permission ditolak
    }
  }

  // ── 3. Web Notification API ─────────────────────────────────────────────────
  if (typeof window !== 'undefined' && 'Notification' in window) {
    try {
      if (Notification.permission === 'granted') {
        new Notification(title, { body: message, icon: '/assets/icon-192.png' });
        return;
      }
      if (Notification.permission !== 'denied') {
        const perm = await Notification.requestPermission();
        if (perm === 'granted') {
          new Notification(title, { body: message, icon: '/assets/icon-192.png' });
          return;
        }
      }
    } catch {
      // fallthrough
    }
  }

  // ── 4. Fallback console ────────────────────────────────────────────────────
  console.info(`[Notifikasi] ${title}: ${message}`);
}

export function isIgnoringBatteryOptimizations(): boolean {
  try {
    return window.AndroidPrabawaAutomasi?.isIgnoringBatteryOptimizations() ?? true;
  } catch {
    return true;
  }
}

export function requestBatteryOptimizationExemption(): void {
  try {
    window.AndroidPrabawaAutomasi?.requestBatteryOptimizationExemption();
  } catch (e) {
    console.warn('[AutomasiBridge] requestBatteryOptimizationExemption error:', e);
  }
}
