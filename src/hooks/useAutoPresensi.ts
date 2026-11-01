/**
 * Hook scheduler auto-presensi yang berjalan di background.
 *
 * Polling setiap 30 detik, memeriksa preset yang layak dieksekusi,
 * memilih lokasi secara acak dari pool, lalu memanggil rpcAbsen.
 *
 * Setelah presensi berhasil/gagal, dikirim notifikasi native Tauri
 * (Android push notification / AppImage desktop notification).
 *
 * Polling berhenti otomatis bila:
 * - `aktif` = false
 * - komponen di-unmount (cleanup useEffect)
 * - pengguna tidak punya username (belum login)
 *
 * Android-aware: listener `visibilitychange` memicu pengecekan ulang
 * segera saat aplikasi kembali ke foreground.
 */

import { useEffect, useRef } from 'react';
import { useAppContext } from '../context/AppContext';
import { useServerContext } from './useServerContext';
import {
  pilihLokasiAcak,
  tulisLog,
  sudahDieksekusiHariIni,
  hariIniAktif,
  dalamRentangWaktu,
  type PresetOtomatisasi,
} from '../lib/presetOtomatisasi';
import { getTodayWIB, getNowWIBTime } from '../lib/dateFormatter';
import { rpcAbsen } from '../lib/apiCalls';
import { ABSEN_CHECK_TYPE, formatLatLong } from '../lib/presensiContract';
import type { LokasiView } from '../lib/viewModels';
import type { ServerContext } from '../lib/apiCalls';
import {
  showAndroidNotification,
  startAndroidForegroundService,
  stopAndroidForegroundService,
} from '../lib/androidBackgroundBridge';

// ═══════════════════════════════════════════════════════════════════════
//  Interval polling (ms)
// ═══════════════════════════════════════════════════════════════════════

const INTERVAL_MS = 30_000; // 30 detik

// ═══════════════════════════════════════════════════════════════════════
//  Opsi hook
// ═══════════════════════════════════════════════════════════════════════

export interface UseAutoPresensiOptions {
  /** Daftar preset yang akan diperiksa. */
  presets: PresetOtomatisasi[];
  /** Daftar lokasi dari server (untuk verifikasi keberadaan id). */
  lokasis: LokasiView[];
  /** Bila false, polling tidak berjalan. */
  aktif: boolean;
  /** Callback opsional setelah eksekusi preset berhasil. */
  onEksekusi?: (preset: PresetOtomatisasi, lokasiId: string) => void;
}

// ═══════════════════════════════════════════════════════════════════════
//  Notifikasi native Tauri
// ═══════════════════════════════════════════════════════════════════════

/**
 * Kirim notifikasi native (Android push / Tauri AppImage / Web notification).
 * 1. Coba Android Native via AndroidPrabawa bridge.
 * 2. Coba Tauri plugin-notification (AppImage/desktop).
 * 3. Fallback ke Web Notification API atau console.
 */
async function kirimNotifikasiNative(judul: string, isi: string): Promise<void> {
  // 1. Android Native Notification
  if (showAndroidNotification(judul, isi)) {
    return;
  }

  // 2. Tauri Plugin Notification (AppImage & Desktop)
  try {
    // Dynamic import — berjalan hanya di runtime Tauri, tidak melempar di browser biasa.
    // ts-expect-error hanya aktif bila plugin belum di-install di node_modules.
    const { sendNotification, isPermissionGranted, requestPermission } =
      // @ts-expect-error — plugin diinstal saat runtime Tauri
      await import('@tauri-apps/plugin-notification');

    let permitted: boolean = await isPermissionGranted();
    if (!permitted) {
      const permission: string = await requestPermission();
      permitted = permission === 'granted';
    }
    if (permitted) {
      await sendNotification({ title: judul, body: isi });
      return;
    }
  } catch {
    // Di luar Tauri atau plugin tidak aktif
  }

  // 3. Web Notification API fallback
  try {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      if (Notification.permission === 'granted') {
        new Notification(judul, { body: isi, icon: '/icons/128x128.png' });
        return;
      } else if (Notification.permission !== 'denied') {
        const perm = await Notification.requestPermission();
        if (perm === 'granted') {
          new Notification(judul, { body: isi, icon: '/icons/128x128.png' });
          return;
        }
      }
    }
  } catch {
    // Abaikan
  }

  console.info(`[Preset Auto] ${judul}: ${isi}`);
}

// ═══════════════════════════════════════════════════════════════════════
//  Peta tipe preset → checktype
// ═══════════════════════════════════════════════════════════════════════

function checkTypeFromTipe(tipe: PresetOtomatisasi['tipe']): number {
  switch (tipe) {
    case 'datang': return ABSEN_CHECK_TYPE.DATANG;
    case 'pulang': return ABSEN_CHECK_TYPE.PULANG;
    case 'custom': return ABSEN_CHECK_TYPE.SIANG;
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  Logika cek & eksekusi preset (fully async, IndexedDB-aware)
// ═══════════════════════════════════════════════════════════════════════

/**
 * Iterasi semua preset, periksa kondisi layak eksekusi (async karena
 * sudahDieksekusiHariIni sekarang IndexedDB), lalu jalankan rpcAbsen.
 */
async function cekDanEksekusiPreset(
  presets: PresetOtomatisasi[],
  lokasis: LokasiView[],
  username: string,
  context: ServerContext,
  onEksekusi?: (preset: PresetOtomatisasi, lokasiId: string) => void,
): Promise<void> {
  const jamSekarang = getNowWIBTime();
  const tanggalHariIni = getTodayWIB();
  const hariSekarang = new Date().getDay();

  for (const preset of presets) {
    if (!preset.aktif) continue;
    if (!hariIniAktif(preset.hariAktif, hariSekarang)) continue;
    if (!dalamRentangWaktu(preset.jamMulai, preset.jamSelesai, jamSekarang)) continue;

    const sudahEksekusi = await sudahDieksekusiHariIni(username, preset.id, tanggalHariIni);
    if (sudahEksekusi) continue;

    // Saring pool lokasi preset ke yang benar-benar ada di server.
    const lokasiValid = preset.lokasiIds.filter(id => lokasis.some(l => l.id === id));
    const lokasiId = pilihLokasiAcak(lokasiValid);

    if (!lokasiId) {
      await tulisLog(username, {
        presetId: preset.id,
        tanggal: tanggalHariIni,
        lokasiDipilih: '',
        eksekusiPada: Date.now(),
        berhasil: false,
        pesan: 'Tidak ada lokasi valid dalam pool preset.',
      });
      await kirimNotifikasiNative(
        '⚠️ Presensi Otomatis Gagal',
        `${preset.nama}: Tidak ada lokasi valid dalam pool.`
      );
      continue;
    }

    // Cari koordinat lokasi yang dipilih untuk disertakan di context.
    const lokasi = lokasis.find(l => l.id === lokasiId);

    let ctxDenganLokasi: ServerContext = context;
    if (lokasi && lokasi.latitude !== null && lokasi.longitude !== null) {
      ctxDenganLokasi = {
        ...context,
        lastLatLong: formatLatLong(lokasi.latitude, lokasi.longitude),
      };
    }

    try {
      const result = await rpcAbsen(ctxDenganLokasi, {
        checkType: checkTypeFromTipe(preset.tipe),
        workCode: preset.workcodeId,
        isWfh: false,
        withIjin: false,
        keterangan: '',
        mock: false,
      });

      if (result === null) {
        throw new Error('Server pusat tidak mengembalikan respon absensi.');
      }
      if (result.absen === false) {
        throw new Error(result.message || 'Server pusat menolak absensi.');
      }

      await tulisLog(username, {
        presetId: preset.id,
        tanggal: tanggalHariIni,
        lokasiDipilih: lokasiId,
        eksekusiPada: Date.now(),
        berhasil: true,
        pesan: `Berhasil via ${lokasi?.nama ?? lokasiId}.`,
      });

      await kirimNotifikasiNative(
        '✅ Presensi Otomatis Berhasil',
        `${preset.nama} — ${lokasi?.nama ?? lokasi?.kode ?? lokasiId}`
      );

      onEksekusi?.(preset, lokasiId);
    } catch (err: unknown) {
      const pesan = err instanceof Error ? err.message : 'Gagal menghubungi server.';
      await tulisLog(username, {
        presetId: preset.id,
        tanggal: tanggalHariIni,
        lokasiDipilih: lokasiId,
        eksekusiPada: Date.now(),
        berhasil: false,
        pesan,
      });

      await kirimNotifikasiNative(
        '⚠️ Presensi Otomatis Gagal',
        `${preset.nama}: ${pesan}`
      );
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  Hook
// ═══════════════════════════════════════════════════════════════════════

export function useAutoPresensi({
  presets,
  lokasis,
  aktif,
  onEksekusi,
}: UseAutoPresensiOptions): void {
  const { currentUser } = useAppContext();
  const { context, ready } = useServerContext();

  const username = currentUser?.username ?? '';

  /**
   * Simpan referensi ke nilai terkini agar closure interval tidak
   * menangkap nilai lama (stale closure).
   */
  const presetsRef = useRef(presets);
  const lokasisRef = useRef(lokasis);
  const contextRef = useRef(context);
  const onEksekusiRef = useRef(onEksekusi);

  // Perbarui ref setiap render supaya interval selalu pakai data terbaru.
  useEffect(() => { presetsRef.current = presets; }, [presets]);
  useEffect(() => { lokasisRef.current = lokasis; }, [lokasis]);
  useEffect(() => { contextRef.current = context; }, [context]);
  useEffect(() => { onEksekusiRef.current = onEksekusi; }, [onEksekusi]);

  // Pasang interval + visibility listener bila aktif & siap, bersihkan bila tidak.
  useEffect(() => {
    if (!aktif || !username || !ready) return;

    // Aktifkan Android Foreground Service agar proses tidak dibunuh oleh OS di latar belakang
    startAndroidForegroundService(
      'PRABAWA Presensi Otomatis',
      'Penjadwal presensi aktif memantau jadwal harian'
    );

    let running = false; // mutex agar tidak double-eksekusi

    const eksekusi = async () => {
      if (running) return;
      running = true;
      try {
        await cekDanEksekusiPreset(
          presetsRef.current,
          lokasisRef.current,
          username,
          contextRef.current,
          onEksekusiRef.current,
        );
      } finally {
        running = false;
      }
    };

    // Jalankan sekali saat pertama mount.
    void eksekusi();

    // Polling tiap 30 detik (berfungsi di AppImage/desktop, Android foreground).
    const intervalId = window.setInterval(() => { void eksekusi(); }, INTERVAL_MS);

    // Visibility change: Android resume dari background → langsung cek ulang.
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') void eksekusi();
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibility);
      stopAndroidForegroundService();
    };
  }, [aktif, username, ready]);
}
