/**
 * Hook yang auto-sync preset aktif dan session ke Android SharedPreferences
 * setiap kali ada perubahan. Dipasang di GlobalPresetScheduler.
 *
 * Data yang di-sync dipakai PrabawaKeepaliveWorker untuk eksekusi presensi
 * langsung dari Kotlin ketika app di-swipe dari Recent Apps.
 */

import { useEffect, useRef } from 'react';
import { useAppContext } from '../context/AppContext';
import { useServerContext } from './useServerContext';
import { bacaSemuaPreset, type PresetOtomatisasi } from '../lib/presetOtomatisasi';
import { bacaTitik } from '../lib/lokasiTersimpan';
import { idPerangkat } from '../lib/idPerangkat';
import { apiUrl } from '../lib/apiBase';
import {
  syncSessionToAndroid,
  syncPresetsToAndroid,
  type PresetSyncData,
} from '../lib/androidPresetSync';

function isAndroid(): boolean {
  return typeof window !== 'undefined' && Boolean((window as any).AndroidPrabawa);
}

export function useAndroidPresetSync(): void {
  const { currentUser, pegawai, config } = useAppContext();
  const { context } = useServerContext();
  const username = currentUser?.username ?? '';

  // Ref untuk tracking apakah perlu sync ulang
  const lastSyncRef = useRef<string>('');

  useEffect(() => {
    if (!isAndroid() || !username || !pegawai?.apiKey) return;

    let cancelled = false;

    async function doSync() {
      try {
        // 1. Sync session
        const session = {
          apiKey: pegawai?.apiKey ?? '',
          imei: config.imei || pegawai?.imei || idPerangkat(username),
          lastLatLong: context.lastLatLong ?? '',
          baseUrl: apiUrl('/api/rpc'),
        };
        syncSessionToAndroid(session);

        // 2. Baca preset aktif
        const presets = await bacaSemuaPreset(username);
        const aktif = presets.filter(p => p.aktif);
        if (!aktif.length || cancelled) return;

        // 3. Resolve lokasi untuk setiap preset
        const semuaTitik = await bacaTitik(username);
        const syncData: PresetSyncData[] = aktif.map((p: PresetOtomatisasi) => ({
          id: p.id,
          nama: p.nama,
          tipe: p.tipe,
          workcodeId: p.workcodeId,
          jamMulai: p.jamMulai,
          jamSelesai: p.jamSelesai,
          hariAktif: p.hariAktif,
          aktif: p.aktif,
          lokasi: p.lokasiIds
            .map(id => semuaTitik.find(t => t.id === id))
            .filter(Boolean)
            .map(t => ({
              id: t!.id,
              nama: t!.nama,
              latitude: t!.latitude,
              longitude: t!.longitude,
            })),
        }));

        // Cek apakah data berubah sebelum sync
        const hash = JSON.stringify(syncData) + session.apiKey + session.lastLatLong;
        if (hash === lastSyncRef.current || cancelled) return;
        lastSyncRef.current = hash;

        syncPresetsToAndroid(syncData);
      } catch (e) {
        console.warn('[AndroidPresetSync] Gagal sync:', e);
      }
    }

    void doSync();

    // Sync ulang setiap 60 detik (untuk update lastLatLong)
    const interval = setInterval(() => { void doSync(); }, 60_000);

    // Sync ulang saat preset diupdate dari UI
    const onPresetUpdated = () => { void doSync(); };
    window.addEventListener('prabawa-preset-updated', onPresetUpdated);

    return () => {
      cancelled = true;
      clearInterval(interval);
      window.removeEventListener('prabawa-preset-updated', onPresetUpdated);
    };
  }, [username, pegawai?.apiKey, config.imei, context.lastLatLong]);
}
