import { useState, useEffect } from 'react';
import { bacaStorage, tulisStorage } from '../lib/storageAman';

/** Kirim tema ke Android (dipanggil bila jalan sebagai Tauri APK). */
function syncThemeToAndroid(isDark: boolean) {
  const trySync = () => {
    try {
      // AndroidPrabawa diinjeksi oleh MainActivity.kt via addJavascriptInterface.
      const bridge = (window as unknown as Record<string, unknown>).AndroidPrabawa as
        | { setTheme?: (dark: boolean) => void }
        | undefined;
      if (typeof bridge?.setTheme === 'function') {
        bridge.setTheme(isDark);
        return true;
      }
    } catch {
      // Bukan Android / bridge belum siap — abaikan.
    }
    return false;
  };

  if (!trySync()) {
    // Jika bridge belum selesai diinjeksi Kotlin saat awal muat, coba beberapa saat lagi.
    [50, 150, 300, 600, 1200, 2500, 5000].forEach((ms) => setTimeout(trySync, ms));
  }
}

export function useDarkMode() {
  /*
   * `bacaStorage`, bukan `localStorage.getItem` langsung.
   *
   * Baris ini jalan di fase render — sebelum React memasang tree. Satu
   * lemparan di sini (Safari mode privat, penyimpanan diblokir kebijakan
   * situs) berarti komponen gagal mounting dan seluruh aplikasi tidak
   * pernah tampil: layar putih, tanpa form login. Penyimpanan yang tidak
   * bisa diakses diperlakukan sebagai "tema belum pernah dipilih", yang
   * membuat aplikasi tetap terbuka dengan tema sistem.
   */
  const [isDarkMode, setIsDarkMode] = useState(() => {
    if (typeof window === 'undefined') return false;
    const saved = bacaStorage('theme');
    if (saved) return saved === 'dark';
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });

  useEffect(() => {
    const root = window.document.documentElement;
    const metaThemeColor = document.getElementById('theme-color-meta') || document.querySelector('meta[name="theme-color"]');

    root.style.colorScheme = isDarkMode ? 'dark' : 'light';
    document.body.dataset.theme = isDarkMode ? 'dark' : 'light';

    if (isDarkMode) {
      root.classList.add('dark');
      root.classList.remove('light');
      tulisStorage('theme', 'dark');
      if (metaThemeColor) metaThemeColor.setAttribute('content', '#0f172a');
    } else {
      root.classList.add('light');
      root.classList.remove('dark');
      tulisStorage('theme', 'light');
      if (metaThemeColor) metaThemeColor.setAttribute('content', '#ffffff');
    }

    // Sinkronkan tema ke Android native (status bar / nav bar icons).
    syncThemeToAndroid(isDarkMode);
  }, [isDarkMode]);

  const toggleDarkMode = () => setIsDarkMode(prev => !prev);

  return { isDarkMode, toggleDarkMode };
}
