/**
 * Hook untuk mengelola state daftar preset otomatisasi presensi.
 *
 * Membungkus operasi CRUD dari presetOtomatisasi.ts (IndexedDB) dalam
 * React state, sehingga perubahan preset langsung memicu re-render komponen.
 * Semua operasi storage bersifat async karena berbasis IndexedDB.
 */

import { useCallback, useEffect, useState } from 'react';
import { useAppContext } from '../context/AppContext';
import {
  bacaSemuaPreset,
  tambahPreset as libTambah,
  perbaruiPreset as libPerbarui,
  hapusPreset as libHapus,
  toggleAktifPreset as libToggle,
  type PresetOtomatisasi,
} from '../lib/presetOtomatisasi';

// ═══════════════════════════════════════════════════════════════════════
//  Tipe return hook
// ═══════════════════════════════════════════════════════════════════════

export interface UsePresetOtomatisasiReturn {
  /** Daftar preset milik pengguna yang sedang login. */
  presets: PresetOtomatisasi[];
  /** True selama data pertama kali dimuat. */
  loading: boolean;
  /** Tambah preset baru ke daftar. */
  tambahPreset: (data: Omit<PresetOtomatisasi, 'id' | 'dibuatPada' | 'diperbarui'>) => Promise<void>;
  /** Perbarui preset yang sudah ada berdasarkan id. */
  perbaruiPreset: (id: string, data: Partial<PresetOtomatisasi>) => Promise<void>;
  /** Hapus preset berdasarkan id. */
  hapusPreset: (id: string) => Promise<void>;
  /** Toggle status aktif preset. */
  toggleAktif: (id: string) => Promise<void>;
  /** Muat ulang daftar dari storage. */
  muat: () => Promise<void>;
}

// ═══════════════════════════════════════════════════════════════════════
//  Hook
// ═══════════════════════════════════════════════════════════════════════

export function usePresetOtomatisasi(): UsePresetOtomatisasiReturn {
  const { currentUser } = useAppContext();
  const username = currentUser?.username ?? '';

  const [presets, setPresets] = useState<PresetOtomatisasi[]>([]);
  const [loading, setLoading] = useState(true);

  /** Baca ulang dari IndexedDB dan perbarui state. */
  const muat = useCallback(async () => {
    if (!username) {
      setPresets([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const data = await bacaSemuaPreset(username);
      setPresets(data);
    } catch {
      // Silent — storage error tidak crash UI.
    } finally {
      setLoading(false);
    }
  }, [username]);

  // Muat saat hook pertama kali dipasang atau username berubah.
  useEffect(() => {
    void muat();
  }, [muat]);

  const tambahPreset = useCallback(
    async (data: Omit<PresetOtomatisasi, 'id' | 'dibuatPada' | 'diperbarui'>) => {
      if (!username) return;
      await libTambah(username, data);
      await muat();
    },
    [username, muat]
  );

  const perbaruiPreset = useCallback(
    async (id: string, data: Partial<PresetOtomatisasi>) => {
      if (!username) return;
      await libPerbarui(username, id, data);
      await muat();
    },
    [username, muat]
  );

  const hapusPreset = useCallback(
    async (id: string) => {
      if (!username) return;
      await libHapus(username, id);
      await muat();
    },
    [username, muat]
  );

  const toggleAktif = useCallback(
    async (id: string) => {
      if (!username) return;
      await libToggle(username, id);
      await muat();
    },
    [username, muat]
  );

  return { presets, loading, tambahPreset, perbaruiPreset, hapusPreset, toggleAktif, muat };
}
