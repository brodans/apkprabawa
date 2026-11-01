/**
 * Library untuk sistem Preset Otomatisasi Presensi.
 *
 * Preset memungkinkan pengguna mendefinisikan aturan absensi otomatis:
 * kapan, di lokasi mana (dipilih acak dari pool), dan workcode apa.
 * Data disimpan di IndexedDB (dua object store: preset-akun & preset-log).
 */

// ═══════════════════════════════════════════════════════════════════════
//  Tipe-tipe utama
// ═══════════════════════════════════════════════════════════════════════

/** Tipe tindakan preset: masuk, pulang, atau kustom (lembur/khusus). */
export type TipePreset = 'datang' | 'pulang' | 'custom';

/** Indeks hari: 0=Minggu, 1=Senin, ..., 6=Sabtu. */
export type HariKerja = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/** Preset otomatisasi presensi. */
export interface PresetOtomatisasi {
  /** UUID unik preset. */
  id: string;
  /** Nama yang mudah dikenali pengguna. */
  nama: string;
  /** Tipe tindakan absensi. */
  tipe: TipePreset;
  /** ID titik lokasi milik akun di IndexedDB, maksimal 20. */
  lokasiIds: string[];
  /** ID workcode yang dipakai untuk absensi. */
  workcodeId: string;
  /** Batas awal eksekusi dalam format "HH:MM". */
  jamMulai: string;
  /** Batas akhir eksekusi dalam format "HH:MM". */
  jamSelesai: string;
  /** Hari-hari yang preset ini aktif. */
  hariAktif: HariKerja[];
  /** Apakah preset diaktifkan atau tidak. */
  aktif: boolean;
  /** Timestamp pembuatan dalam milidetik. */
  dibuatPada: number;
  /** Timestamp pembaruan terakhir dalam milidetik. */
  diperbarui: number;
}

/** Log eksekusi harian — mencegah double-eksekusi pada hari yang sama. */
export interface LogEksekusi {
  /** ID preset yang dieksekusi. */
  presetId: string;
  /** Tanggal eksekusi format "YYYY-MM-DD" WIB. */
  tanggal: string;
  /** ID lokasi yang terpilih secara acak. */
  lokasiDipilih: string;
  /** Timestamp eksekusi dalam milidetik. */
  eksekusiPada: number;
  /** Apakah eksekusi berhasil. */
  berhasil: boolean;
  /** Pesan tambahan (opsional). */
  pesan?: string;
}

// ═══════════════════════════════════════════════════════════════════════
//  Konstanta IndexedDB
// ═══════════════════════════════════════════════════════════════════════

const DB_NAME = 'prabawa-preset';
const DB_VERSION = 1;
const STORE_AKUN = 'preset-akun';
const STORE_LOG = 'preset-log';

/** Batas maksimal lokasi di satu pool preset. */
export const MAX_LOKASI_POOL = 20;

// ═══════════════════════════════════════════════════════════════════════
//  Konstanta nama hari (untuk tampilan UI)
// ═══════════════════════════════════════════════════════════════════════

/** Label singkat hari untuk chip. */
export const LABEL_HARI: Record<HariKerja, string> = {
  0: 'Min',
  1: 'Sen',
  2: 'Sel',
  3: 'Rab',
  4: 'Kam',
  5: 'Jum',
  6: 'Sab',
};

/** Label panjang hari. */
export const LABEL_HARI_PANJANG: Record<HariKerja, string> = {
  0: 'Minggu',
  1: 'Senin',
  2: 'Selasa',
  3: 'Rabu',
  4: 'Kamis',
  5: "Jum'at",
  6: 'Sabtu',
};

/** Urutan hari dalam UI (Senin–Minggu untuk konvensi Indonesia). */
export const URUTAN_HARI: HariKerja[] = [1, 2, 3, 4, 5, 6, 0];

// ═══════════════════════════════════════════════════════════════════════
//  Rekaman internal IndexedDB
// ═══════════════════════════════════════════════════════════════════════

interface RekamanPreset {
  akun: string;
  presets: PresetOtomatisasi[];
}

interface RekamanLog {
  kunci: string; // `${kunciAkun(username)}__${tanggal}`
  logs: LogEksekusi[];
}

// ═══════════════════════════════════════════════════════════════════════
//  Buka database (singleton promise)
// ═══════════════════════════════════════════════════════════════════════

let databasePromise: Promise<IDBDatabase> | null = null;

function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof indexedDB !== 'undefined';
}

function bukaDatabase(): Promise<IDBDatabase> {
  if (!isBrowser()) return Promise.reject(new Error('IndexedDB tidak tersedia di perangkat ini.'));
  if (databasePromise) return databasePromise;

  const opening = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_AKUN)) {
        db.createObjectStore(STORE_AKUN, { keyPath: 'akun' });
      }
      if (!db.objectStoreNames.contains(STORE_LOG)) {
        db.createObjectStore(STORE_LOG, { keyPath: 'kunci' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Gagal membuka penyimpanan preset.'));
    request.onblocked = () => reject(new Error('Tutup tab lain untuk memperbarui penyimpanan preset.'));
  });

  databasePromise = opening.catch(err => {
    databasePromise = null;
    throw err;
  });

  return databasePromise!;
}

// ═══════════════════════════════════════════════════════════════════════
//  Sanitasi kunci akun
// ═══════════════════════════════════════════════════════════════════════

/**
 * Sanitasi username agar aman dipakai sebagai kunci IndexedDB.
 * Karakter spesial diganti `_` dan dipotong 64 karakter.
 */
function kunciAkun(username: string): string {
  const bersih = String(username ?? '')
    .trim()
    .replace(/[/\\.#$[\]]/g, '_')
    .slice(0, 64);
  return bersih || 'tanpa-nama';
}

// ═══════════════════════════════════════════════════════════════════════
//  Pembuat ID
// ═══════════════════════════════════════════════════════════════════════

/**
 * Buat ID unik.
 * Memakai crypto.randomUUID() dengan fallback untuk lingkungan tanpa crypto.
 */
function buatId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    // Fallback kalau crypto tidak tersedia.
  }
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

// ═══════════════════════════════════════════════════════════════════════
//  Operasi IndexedDB — Preset
// ═══════════════════════════════════════════════════════════════════════

async function bacaRekamanPreset(username: string): Promise<RekamanPreset | null> {
  const db = await bukaDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_AKUN, 'readonly');
    const req = tx.objectStore(STORE_AKUN).get(kunciAkun(username));
    let hasil: RekamanPreset | null = null;
    req.onsuccess = () => {
      const r = req.result as RekamanPreset | undefined;
      if (r && typeof r === 'object' && Array.isArray(r.presets)) {
        hasil = r;
      }
    };
    tx.oncomplete = () => resolve(hasil);
    tx.onerror = () => reject(tx.error ?? new Error('Gagal membaca preset.'));
    tx.onabort = () => reject(tx.error ?? new Error('Pembacaan preset dibatalkan.'));
  });
}

async function tulisRekamanPreset(record: RekamanPreset): Promise<void> {
  const db = await bukaDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_AKUN, 'readwrite');
    tx.objectStore(STORE_AKUN).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Gagal menyimpan preset.'));
    tx.onabort = () => reject(tx.error ?? new Error('Penyimpanan preset dibatalkan.'));
  });
}

// ═══════════════════════════════════════════════════════════════════════
//  Operasi IndexedDB — Log
// ═══════════════════════════════════════════════════════════════════════

function kunciLog(username: string, tanggal: string): string {
  return `${kunciAkun(username)}__${tanggal}`;
}

async function bacaRekamanLog(username: string, tanggal: string): Promise<RekamanLog | null> {
  const db = await bukaDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_LOG, 'readonly');
    const req = tx.objectStore(STORE_LOG).get(kunciLog(username, tanggal));
    let hasil: RekamanLog | null = null;
    req.onsuccess = () => {
      const r = req.result as RekamanLog | undefined;
      if (r && typeof r === 'object' && Array.isArray(r.logs)) {
        hasil = r;
      }
    };
    tx.oncomplete = () => resolve(hasil);
    tx.onerror = () => reject(tx.error ?? new Error('Gagal membaca log preset.'));
    tx.onabort = () => reject(tx.error ?? new Error('Pembacaan log preset dibatalkan.'));
  });
}

async function tulisRekamanLog(record: RekamanLog): Promise<void> {
  const db = await bukaDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_LOG, 'readwrite');
    tx.objectStore(STORE_LOG).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Gagal menyimpan log preset.'));
    tx.onabort = () => reject(tx.error ?? new Error('Penyimpanan log preset dibatalkan.'));
  });
}

// ═══════════════════════════════════════════════════════════════════════
//  CRUD Preset — async (IndexedDB)
// ═══════════════════════════════════════════════════════════════════════

/**
 * Baca semua preset untuk pengguna tertentu.
 * Mengembalikan array kosong bila belum ada atau storage gagal.
 */
export async function bacaSemuaPreset(username: string): Promise<PresetOtomatisasi[]> {
  try {
    const record = await bacaRekamanPreset(username);
    return record?.presets ?? [];
  } catch {
    return [];
  }
}

/** Simpan seluruh daftar preset untuk pengguna. */
export async function simpanSemuaPreset(username: string, presets: PresetOtomatisasi[]): Promise<void> {
  await tulisRekamanPreset({ akun: kunciAkun(username), presets });
}

/**
 * Tambah preset baru.
 * Mengembalikan preset yang sudah dilengkapi id & timestamp.
 */
export async function tambahPreset(
  username: string,
  preset: Omit<PresetOtomatisasi, 'id' | 'dibuatPada' | 'diperbarui'>
): Promise<PresetOtomatisasi> {
  const sekarang = Date.now();
  const baru: PresetOtomatisasi = {
    ...preset,
    id: buatId(),
    dibuatPada: sekarang,
    diperbarui: sekarang,
  };
  const daftar = await bacaSemuaPreset(username);
  await simpanSemuaPreset(username, [...daftar, baru]);
  return baru;
}

/**
 * Perbarui preset yang sudah ada.
 * Mengembalikan preset yang diperbarui, atau null bila id tidak ditemukan.
 */
export async function perbaruiPreset(
  username: string,
  id: string,
  perubahan: Partial<PresetOtomatisasi>
): Promise<PresetOtomatisasi | null> {
  const daftar = await bacaSemuaPreset(username);
  let hasilUpdate: PresetOtomatisasi | null = null;
  const daftarBaru = daftar.map(p => {
    if (p.id !== id) return p;
    hasilUpdate = { ...p, ...perubahan, id, diperbarui: Date.now() };
    return hasilUpdate;
  });
  if (hasilUpdate !== null) await simpanSemuaPreset(username, daftarBaru);
  return hasilUpdate;
}

/** Hapus preset berdasarkan id. */
export async function hapusPreset(username: string, id: string): Promise<void> {
  const daftar = await bacaSemuaPreset(username);
  await simpanSemuaPreset(username, daftar.filter(p => p.id !== id));
}

/**
 * Toggle status aktif preset.
 * Mengembalikan preset yang diperbarui, atau null bila id tidak ditemukan.
 */
export async function toggleAktifPreset(username: string, id: string): Promise<PresetOtomatisasi | null> {
  const daftar = await bacaSemuaPreset(username);
  const target = daftar.find(p => p.id === id);
  if (!target) return null;
  return perbaruiPreset(username, id, { aktif: !target.aktif });
}

// ═══════════════════════════════════════════════════════════════════════
//  Log eksekusi — async (IndexedDB)
// ═══════════════════════════════════════════════════════════════════════

/**
 * Baca semua log eksekusi untuk tanggal tertentu.
 * Mengembalikan array kosong bila tidak ada atau storage gagal.
 */
export async function bacaLogHarian(username: string, tanggal: string): Promise<LogEksekusi[]> {
  try {
    const record = await bacaRekamanLog(username, tanggal);
    return record?.logs ?? [];
  } catch {
    return [];
  }
}

/** Tulis satu entri log eksekusi. */
export async function tulisLog(username: string, log: LogEksekusi): Promise<void> {
  const daftar = await bacaLogHarian(username, log.tanggal);
  // Ganti bila sudah ada log untuk preset yang sama pada tanggal itu.
  const idx = daftar.findIndex(l => l.presetId === log.presetId);
  if (idx >= 0) {
    daftar[idx] = log;
  } else {
    daftar.push(log);
  }
  await tulisRekamanLog({ kunci: kunciLog(username, log.tanggal), logs: daftar });
}

/**
 * Periksa apakah preset sudah dieksekusi hari ini.
 * Memakai log harian untuk memastikan tidak terjadi double-eksekusi.
 */
export async function sudahDieksekusiHariIni(
  username: string,
  presetId: string,
  tanggal: string
): Promise<boolean> {
  const daftar = await bacaLogHarian(username, tanggal);
  return daftar.some(l => l.presetId === presetId && l.berhasil);
}

// ═══════════════════════════════════════════════════════════════════════
//  Pemilih lokasi acak — PURE (sync)
// ═══════════════════════════════════════════════════════════════════════

/**
 * Pilih satu ID lokasi secara acak dari pool yang diberikan.
 * Mengembalikan null bila array kosong.
 */
export function pilihLokasiAcak(lokasiIds: string[]): string | null {
  if (lokasiIds.length === 0) return null;
  const idx = Math.floor(Math.random() * lokasiIds.length);
  return lokasiIds[idx];
}

// ═══════════════════════════════════════════════════════════════════════
//  Validasi waktu & hari — PURE (sync)
// ═══════════════════════════════════════════════════════════════════════

/**
 * Periksa apakah waktu saat ini berada dalam rentang jam mulai–selesai.
 * Semua parameter berformat "HH:MM".
 */
export function dalamRentangWaktu(
  jamMulai: string,
  jamSelesai: string,
  jamSekarang: string
): boolean {
  const keMenit = (hhmm: string): number => {
    const parts = hhmm.split(':');
    if (parts.length < 2) return -1;
    const jam = Number(parts[0]);
    const menit = Number(parts[1]);
    if (isNaN(jam) || isNaN(menit)) return -1;
    return jam * 60 + menit;
  };
  const mulai = keMenit(jamMulai);
  const selesai = keMenit(jamSelesai);
  const sekarang = keMenit(jamSekarang);
  if (mulai < 0 || selesai < 0 || sekarang < 0) return false;

  // Rentang normal (misal 06:00 - 06:50)
  if (mulai <= selesai) {
    return mulai <= sekarang && sekarang <= selesai;
  }
  // Rentang melintasi tengah malam (misal 23:00 - 02:00)
  return sekarang >= mulai || sekarang <= selesai;
}

/** Waktu pseudo-acak yang tetap sama untuk preset dan tanggal yang sama. */
export function waktuAcakPreset(
  presetId: string,
  tanggal: string,
  jamMulai: string,
  jamSelesai: string,
): string | null {
  const keMenit = (hhmm: string): number => {
    const cocok = /^(\d{2}):(\d{2})$/.exec(hhmm);
    if (!cocok) return -1;
    const jam = Number(cocok[1]);
    const menit = Number(cocok[2]);
    return jam < 24 && menit < 60 ? jam * 60 + menit : -1;
  };
  const mulai = keMenit(jamMulai);
  const selesai = keMenit(jamSelesai);
  if (mulai < 0 || selesai < 0 || !tanggal) return null;

  const durasi = (selesai - mulai + 1440) % 1440;
  const seed = `${presetId}:${tanggal}`;
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash = Math.imul(hash ^ seed.charCodeAt(index), 16777619);
  }
  const menitTerpilih = (mulai + ((hash >>> 0) % (durasi + 1))) % 1440;
  return `${String(Math.floor(menitTerpilih / 60)).padStart(2, '0')}:${String(menitTerpilih % 60).padStart(2, '0')}`;
}

/** Benar setelah waktu acak harian tercapai dan selama masih di rentang. */
export function waktuAcakPresetSudahTiba(
  presetId: string,
  tanggal: string,
  jamMulai: string,
  jamSelesai: string,
  jamSekarang: string,
): boolean {
  const keMenit = (hhmm: string): number => {
    const cocok = /^(\d{2}):(\d{2})$/.exec(hhmm);
    if (!cocok) return -1;
    const jam = Number(cocok[1]);
    const menit = Number(cocok[2]);
    return jam < 24 && menit < 60 ? jam * 60 + menit : -1;
  };
  const mulai = keMenit(jamMulai);
  const selesai = keMenit(jamSelesai);
  const sekarang = keMenit(jamSekarang);
  const target = waktuAcakPreset(presetId, tanggal, jamMulai, jamSelesai);
  if (mulai < 0 || selesai < 0 || sekarang < 0 || !target) return false;

  const durasi = (selesai - mulai + 1440) % 1440;
  const waktuBerjalan = (sekarang - mulai + 1440) % 1440;
  const targetBerjalan = (keMenit(target) - mulai + 1440) % 1440;
  return waktuBerjalan <= durasi && waktuBerjalan >= targetBerjalan;
}

/**
 * Periksa apakah hari saat ini termasuk hari yang aktif di preset.
 * hariSekarang: 0=Minggu, 1=Senin, ..., 6=Sabtu.
 */
export function hariIniAktif(hariAktif: HariKerja[], hariSekarang: number): boolean {
  return hariAktif.includes(hariSekarang as HariKerja);
}
