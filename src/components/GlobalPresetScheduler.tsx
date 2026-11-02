/**
 * Komponen Scheduler Global untuk Preset Otomatisasi Presensi.
 *
 * Berjalan di tingkat atas aplikasi (AppShell), sehingga penjadwal tetap aktif
 * memantau waktu presensi baik saat pengguna berada di Beranda, Presensi,
 * maupun tab lainnya, serta saat aplikasi diminimalkan (background / AppImage).
 *
 * Menggunakan IndexedDB untuk membaca preset per-akun dan useAutoPresensi
 * untuk memicu eksekusi serta notifikasi native (Android / Desktop).
 */

import { useEffect, useState, useCallback } from 'react';
import { useAppContext } from '../context/AppContext';
import { useServerContext } from '../hooks/useServerContext';
import { useAutoPresensi } from '../hooks/useAutoPresensi';
import { useAndroidPresetSync } from '../hooks/useAndroidPresetSync';
import {
  bacaSemuaPreset,
  type PresetOtomatisasi,
} from '../lib/presetOtomatisasi';
import { bacaStorage, tulisStorage } from '../lib/storageAman';

const KUNCI_STORAGE_PENJADWAL = 'prabawa_penjadwal_otomatis_aktif';

/** Helper untuk membaca status aktif penjadwal dari storage (default: true). */
export function getPenjadwalAktifStorage(): boolean {
  return bacaStorage(KUNCI_STORAGE_PENJADWAL, 'true') !== 'false';
}

/** Helper untuk menyimpan status aktif penjadwal ke storage dan menyebarkan event. */
export function setPenjadwalAktifStorage(aktif: boolean): void {
  tulisStorage(KUNCI_STORAGE_PENJADWAL, aktif ? 'true' : 'false');
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('prabawa-scheduler-toggle', { detail: aktif }));
  }
}

/** Helper untuk memberitahu scheduler bahwa data preset telah diperbarui. */
export function notifyPresetUpdated(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('prabawa-preset-updated'));
  }
}

export default function GlobalPresetScheduler() {
  const { currentUser, pegawai } = useAppContext();
  const { ready } = useServerContext();

  const username = currentUser?.username ?? '';
  const [presets, setPresets] = useState<PresetOtomatisasi[]>([]);
  const [penjadwalAktif, setPenjadwalAktif] = useState<boolean>(() => getPenjadwalAktifStorage());

  // Muat preset dari IndexedDB
  const muatPreset = useCallback(async () => {
    if (!username) {
      setPresets([]);
      return;
    }
    try {
      const data = await bacaSemuaPreset(username);
      setPresets(data);
    } catch (err) {
      console.warn('[GlobalScheduler] Gagal membaca preset dari IndexedDB:', err);
    }
  }, [username]);

  // Muat preset saat username berubah.
  useEffect(() => {
    void muatPreset();
  }, [muatPreset]);

  // Dengarkan event pembaruan dari halaman PresetOtomatisasi
  useEffect(() => {
    const handleToggle = (e: Event) => {
      const customEvent = e as CustomEvent<boolean>;
      setPenjadwalAktif(customEvent.detail);
    };

    const handleUpdated = () => {
      void muatPreset();
    };

    window.addEventListener('prabawa-scheduler-toggle', handleToggle);
    window.addEventListener('prabawa-preset-updated', handleUpdated);

    return () => {
      window.removeEventListener('prabawa-scheduler-toggle', handleToggle);
      window.removeEventListener('prabawa-preset-updated', handleUpdated);
    };
  }, [muatPreset]);

  // Jalankan scheduler latar belakang dengan notifikasi native
  useAutoPresensi({
    presets,
    aktif: penjadwalAktif && ready && !!username && !!pegawai,
  });

  // Sync preset dan session ke SharedPreferences Android agar
  // KeepaliveWorker bisa eksekusi presensi meski app di-swipe dari recents
  useAndroidPresetSync();

  return null;
}
