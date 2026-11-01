/**
 * Bridge komunikasi antara React frontend dan native Android (PrabawaBridge).
 *
 * Mengontrol:
 * 1. Foreground Service (START_STICKY) agar aplikasi tidak dimatikan Android di latar belakang.
 * 2. Push notifikasi native Android via NotificationCompat.
 * 3. Permintaan pengecualian optimasi baterai (Battery Optimization Exemption).
 */

interface AndroidPrabawaInterface {
  setTheme?: (dark: boolean) => void;
  setOverlayMode?: (active: boolean) => void;
  startForegroundService?: (title?: string, content?: string) => void;
  stopForegroundService?: () => void;
  showNotification?: (title: string, message: string) => boolean;
  isIgnoringBatteryOptimizations?: () => boolean;
  requestBatteryOptimizationExemption?: () => void;
}

function getAndroidBridge(): AndroidPrabawaInterface | undefined {
  if (typeof window === 'undefined') return undefined;
  return (window as unknown as Record<string, unknown>).AndroidPrabawa as
    | AndroidPrabawaInterface
    | undefined;
}

/** Periksa apakah aplikasi sedang berjalan di lingkungan WebView Android Prabawa. */
export function isAndroidPrabawa(): boolean {
  return typeof getAndroidBridge() !== 'undefined';
}

/**
 * Nyalakan Android Foreground Service.
 * Menampilkan notifikasi persisten di status bar dan mencegah Android OS
 * membunuh proses aplikasi saat berada di latar belakang atau layar mati.
 */
export function startAndroidForegroundService(
  title: string = 'PRABAWA Presensi',
  content: string = 'Penjadwal presensi otomatis aktif di latar belakang'
): void {
  try {
    getAndroidBridge()?.startForegroundService?.(title, content);
  } catch (err) {
    console.warn('[AndroidBridge] Gagal menyalakan Foreground Service:', err);
  }
}

/** Hentikan Android Foreground Service. */
export function stopAndroidForegroundService(): void {
  try {
    getAndroidBridge()?.stopForegroundService?.();
  } catch (err) {
    console.warn('[AndroidBridge] Gagal menghentikan Foreground Service:', err);
  }
}

/**
 * Tampilkan notifikasi push native di Android.
 * Menggunakan NotificationCompat dengan prioritas tinggi dan getaran.
 */
export function showAndroidNotification(title: string, message: string): boolean {
  try {
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
    getAndroidBridge()?.requestBatteryOptimizationExemption?.();
  } catch (err) {
    console.warn('[AndroidBridge] Gagal meminta izin optimasi baterai:', err);
  }
}

/** Periksa apakah Android sudah mengecualikan aplikasi dari optimasi baterai. */
export function androidBatteryOptimizationDiizinkan(): boolean {
  try {
    return getAndroidBridge()?.isIgnoringBatteryOptimizations?.() ?? false;
  } catch {
    return false;
  }
}
