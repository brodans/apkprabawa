/**
 * Bridge komunikasi antara React frontend dan native Android.
 *
 * Mengontrol:
 * 1. Foreground Service (START_STICKY) agar aplikasi tidak dimatikan Android di latar belakang.
 * 2. Push notifikasi native Android via NotificationCompat.
 * 3. Permintaan pengecualian optimasi baterai (Battery Optimization Exemption).
 *
 * Arsitektur bridge dua-tingkat:
 *   - AndroidPrabawa       → tema, overlay, izin notifikasi (PrabawaBridge di MainActivity.kt)
 *   - AndroidPrabawaAutomasi → foreground service, notifikasi otomatisasi, battery exemption
 *                             (PrabawaAutomasiBridge di MainActivity.kt)
 */

interface AndroidPrabawaInterface {
  setTheme?: (dark: boolean) => void;
  setOverlayMode?: (active: boolean) => void;
  startForegroundService?: (title?: string, content?: string) => void;
  stopForegroundService?: () => void;
  requestNotificationPermission?: () => void;
  showNotification?: (title: string, message: string) => boolean;
  isIgnoringBatteryOptimizations?: () => boolean;
  requestBatteryOptimizationExemption?: () => void;
}

interface AndroidPrabawaAutomasiInterface {
  startForegroundService(title: string, content: string): void;
  stopForegroundService(): void;
  showNotification(title: string, message: string): boolean;
  requestBatteryOptimizationExemption(): void;
  isIgnoringBatteryOptimizations(): boolean;
}

declare global {
  interface Window {
    AndroidPrabawa?: AndroidPrabawaInterface;
    AndroidPrabawaAutomasi?: AndroidPrabawaAutomasiInterface;
  }
}

function getAndroidBridge(): AndroidPrabawaInterface | undefined {
  if (typeof window === 'undefined') return undefined;
  return (window as unknown as Record<string, unknown>).AndroidPrabawa as
    | AndroidPrabawaInterface
    | undefined;
}

function getAndroidAutomasiBridge(): AndroidPrabawaAutomasiInterface | undefined {
  if (typeof window === 'undefined') return undefined;
  return (window as unknown as Record<string, unknown>).AndroidPrabawaAutomasi as
    | AndroidPrabawaAutomasiInterface
    | undefined;
}

/** Periksa apakah aplikasi sedang berjalan di lingkungan WebView Android Prabawa. */
export function isAndroidPrabawa(): boolean {
  return Boolean(getAndroidAutomasiBridge() ?? getAndroidBridge());
}

/**
 * Nyalakan Android Foreground Service.
 * Menampilkan notifikasi persisten di status bar dan mencegah Android OS
 * membunuh proses aplikasi saat berada di latar belakang atau layar mati.
 * Juga menyimpan state di SharedPreferences agar BootReceiver & WorkManager tahu.
 */
export function startAndroidForegroundService(
  title: string = 'PRABAWA Presensi',
  content: string = 'Penjadwal presensi otomatis aktif di latar belakang'
): void {
  try {
    // Prioritaskan AutomasiBridge (terpisah, lebih andal)
    const automasi = getAndroidAutomasiBridge();
    if (automasi) {
      automasi.startForegroundService(title, content);
      return;
    }
    // Fallback ke PrabawaBridge lama
    getAndroidBridge()?.startForegroundService?.(title, content);
  } catch (err) {
    console.warn('[AndroidBridge] Gagal menyalakan Foreground Service:', err);
  }
}

/** Hentikan Android Foreground Service. */
export function stopAndroidForegroundService(): void {
  try {
    const automasi = getAndroidAutomasiBridge();
    if (automasi) {
      automasi.stopForegroundService();
      return;
    }
    getAndroidBridge()?.stopForegroundService?.();
  } catch (err) {
    console.warn('[AndroidBridge] Gagal menghentikan Foreground Service:', err);
  }
}

/** Minta izin notifikasi Android 13+ agar status service dan hasil presensi terlihat. */
export function requestAndroidNotificationPermission(): void {
  try {
    getAndroidBridge()?.requestNotificationPermission?.();
  } catch (err) {
    console.warn('[AndroidBridge] Gagal meminta izin notifikasi:', err);
  }
}

/**
 * Tampilkan notifikasi push native di Android.
 * Menggunakan NotificationCompat dengan prioritas tinggi dan getaran.
 */
export function showAndroidNotification(title: string, message: string): boolean {
  try {
    // Prioritaskan AutomasiBridge (IMPORTANCE_HIGH + BigTextStyle)
    const automasi = getAndroidAutomasiBridge();
    if (automasi) {
      return automasi.showNotification(title, message);
    }
    const bridge = getAndroidBridge();
    if (bridge?.showNotification) {
      bridge.showNotification(title, message);
      return true;
    }
  } catch (err) {
    console.warn('[AndroidBridge] Gagal mengirim notifikasi Android:', err);
  }
  return false;
}

/**
 * Buka dialog / pengaturan sistem Android untuk mengizinkan aplikasi
 * berjalan tanpa dibatasi oleh penghemat baterai (Doze mode).
 */
export function requestAndroidBatteryOptimization(): void {
  try {
    const automasi = getAndroidAutomasiBridge();
    if (automasi) {
      automasi.requestBatteryOptimizationExemption();
      return;
    }
    getAndroidBridge()?.requestBatteryOptimizationExemption?.();
  } catch (err) {
    console.warn('[AndroidBridge] Gagal meminta izin optimasi baterai:', err);
  }
}

/** Periksa apakah Android sudah mengecualikan aplikasi dari optimasi baterai. */
export function androidBatteryOptimizationDiizinkan(): boolean {
  try {
    const automasi = getAndroidAutomasiBridge();
    if (automasi) return automasi.isIgnoringBatteryOptimizations();
    return getAndroidBridge()?.isIgnoringBatteryOptimizations?.() ?? false;
  } catch {
    return false;
  }
}
