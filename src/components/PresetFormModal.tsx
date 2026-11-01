/**
 * Modal form untuk membuat atau mengedit preset otomatisasi presensi.
 *
 * Layout mobile-first dengan field:
 * - Nama preset
 * - Tipe (pill button: Datang/Pulang/Absen Siang)
 * - Workcode (Dropdown)
 * - Jam mulai & selesai (dua input type=time berdampingan)
 * - Hari aktif (chip toggle 7 hari)
 * - Pool lokasi (multi-select dengan search, maks 20)
 */

import { useEffect, useMemo, useState } from 'react';
import { Search, MapPin, Zap } from 'lucide-react';
import { Modal } from './ui/Modal';
import { Field, Input, ActionButton } from './ui/Surface';
import Dropdown from './ui/Dropdown';
import type { PresetOtomatisasi, TipePreset, HariKerja } from '../lib/presetOtomatisasi';
import { LABEL_HARI, URUTAN_HARI } from '../lib/presetOtomatisasi';
import type { TitikAbsen } from '../lib/lokasiTersimpan';
import type { WorkCodeView } from '../lib/viewModels';

// ═══════════════════════════════════════════════════════════════════════
//  Props
// ═══════════════════════════════════════════════════════════════════════

export interface PresetFormModalProps {
  /** Apakah modal terbuka. */
  buka: boolean;
  /** Callback tutup modal. */
  onTutup: () => void;
  /** Callback simpan data form. */
  onSimpan: (data: Omit<PresetOtomatisasi, 'id' | 'dibuatPada' | 'diperbarui'>) => void;
  /** Preset yang diedit. null = mode tambah baru. */
  preset?: PresetOtomatisasi | null;
  /** Daftar lokasi milik akun dari IndexedDB. */
  lokasiTersimpan: TitikAbsen[];
  /** Daftar workcode dari server. */
  workcodes: WorkCodeView[];
}

// ═══════════════════════════════════════════════════════════════════════
//  State form internal
// ═══════════════════════════════════════════════════════════════════════

interface FormState {
  nama: string;
  tipe: TipePreset;
  workcodeId: string;
  jamMulai: string;
  jamSelesai: string;
  hariAktif: HariKerja[];
  lokasiIds: string[];
  aktif: boolean;
}

const FORM_KOSONG: FormState = {
  nama: '',
  tipe: 'datang',
  workcodeId: '',
  jamMulai: '07:00',
  jamSelesai: '09:00',
  hariAktif: [1, 2, 3, 4, 5],  // Senin–Jumat
  lokasiIds: [],
  aktif: true,
};

// ═══════════════════════════════════════════════════════════════════════
//  Konstanta label tipe
// ═══════════════════════════════════════════════════════════════════════

const TIPE_OPTIONS: { tipe: TipePreset; label: string }[] = [
  { tipe: 'datang', label: 'Datang' },
  { tipe: 'pulang', label: 'Pulang' },
  { tipe: 'custom', label: 'Absen Siang' },
];

const MAKS_LOKASI = 20;

// ═══════════════════════════════════════════════════════════════════════
//  Komponen
// ═══════════════════════════════════════════════════════════════════════

export default function PresetFormModal({
  buka,
  onTutup,
  onSimpan,
  preset,
  lokasiTersimpan,
  workcodes,
}: PresetFormModalProps) {
  const modeEdit = preset != null;
  const [form, setForm] = useState<FormState>(FORM_KOSONG);
  const [cariLokasi, setCariLokasi] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Reset form setiap kali modal dibuka.
  useEffect(() => {
    if (!buka) return;
    if (preset) {
      setForm({
        nama: preset.nama,
        tipe: preset.tipe,
        workcodeId: preset.workcodeId,
        jamMulai: preset.jamMulai,
        jamSelesai: preset.jamSelesai,
        hariAktif: [...preset.hariAktif],
        lokasiIds: [...preset.lokasiIds],
        aktif: preset.aktif,
      });
    } else {
      setForm(FORM_KOSONG);
    }
    setCariLokasi('');
    setError(null);
  }, [buka, preset]);

  /** Helper update field. */
  const set = <K extends keyof FormState>(key: K, val: FormState[K]) =>
    setForm(prev => ({ ...prev, [key]: val }));

  /** Toggle hari aktif. */
  const toggleHari = (hari: HariKerja) => {
    setForm(prev => {
      const sudahAda = prev.hariAktif.includes(hari);
      return {
        ...prev,
        hariAktif: sudahAda
          ? prev.hariAktif.filter(h => h !== hari)
          : [...prev.hariAktif, hari],
      };
    });
  };

  /** Toggle lokasi dalam pool. */
  const toggleLokasi = (id: string) => {
    setForm(prev => {
      const sudahAda = prev.lokasiIds.includes(id);
      if (sudahAda) {
        return { ...prev, lokasiIds: prev.lokasiIds.filter(l => l !== id) };
      }
      if (prev.lokasiIds.length >= MAKS_LOKASI) return prev; // batas maks
      return { ...prev, lokasiIds: [...prev.lokasiIds, id] };
    });
  };

  /** Lokasi yang tersaring oleh kata kunci pencarian. */
  const lokasiFiltrat = useMemo(() => {
    const q = cariLokasi.trim().toLowerCase();
    if (!q) return lokasiTersimpan;
    return lokasiTersimpan.filter(
      lokasi =>
        lokasi.nama.toLowerCase().includes(q) ||
        `${lokasi.latitude},${lokasi.longitude}`.includes(q)
    );
  }, [lokasiTersimpan, cariLokasi]);

  /** Opsi dropdown workcode. id dikonversi ke string karena OpsiDropdown.value = string. */
  const opsiWorkcode = useMemo(
    () => workcodes.map(w => ({ value: String(w.id), label: w.nama })),
    [workcodes]
  );

  /** Validasi & kirim form. */
  const handleSimpan = () => {
    if (!form.nama.trim()) {
      setError('Nama preset wajib diisi.');
      return;
    }
    if (!form.workcodeId) {
      setError('Workcode wajib dipilih.');
      return;
    }
    if (form.hariAktif.length === 0) {
      setError('Pilih minimal satu hari aktif.');
      return;
    }
    if (form.lokasiIds.length === 0) {
      setError('Pilih minimal satu lokasi dalam pool.');
      return;
    }
    setError(null);
    onSimpan({
      nama: form.nama.trim(),
      tipe: form.tipe,
      workcodeId: form.workcodeId,
      jamMulai: form.jamMulai,
      jamSelesai: form.jamSelesai,
      hariAktif: [...form.hariAktif],
      lokasiIds: [...form.lokasiIds],
      aktif: form.aktif,
    });
  };

  return (
    <Modal
      open={buka}
      onClose={onTutup}
      size="md"
      title={modeEdit ? 'Edit Preset' : 'Tambah Preset'}
      icon={<Zap className="w-4 h-4 text-amber-500" />}
      footer={
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <ActionButton variant="ghost" size="sm" onClick={onTutup}>
            Batal
          </ActionButton>
          <ActionButton variant="primary" size="sm" onClick={handleSimpan}>
            {modeEdit ? 'Simpan Perubahan' : 'Tambah Preset'}
          </ActionButton>
        </div>
      }
    >
      <div className="space-y-5">
        {/* Pesan error validasi */}
        {error && (
          <p className="text-xs font-medium text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/20 rounded-xl px-3.5 py-2.5">
            {error}
          </p>
        )}

        {/* ── Nama Preset ── */}
        <Field label="Nama Preset" required>
          <Input
            placeholder="Contoh: Datang Pagi Otomatis"
            value={form.nama}
            onChange={e => set('nama', e.target.value)}
            maxLength={80}
          />
        </Field>

        {/* ── Tipe ── */}
        <Field label="Tipe Presensi">
          <div className="flex gap-2">
            {TIPE_OPTIONS.map(({ tipe, label }) => (
              <button
                key={tipe}
                type="button"
                onClick={() => set('tipe', tipe)}
                className={`flex-1 py-2 rounded-xl text-xs font-bold border transition-colors ${
                  form.tipe === tipe
                    ? tipe === 'datang'
                      ? 'bg-emerald-600 border-emerald-600 text-white'
                      : tipe === 'pulang'
                        ? 'bg-amber-500 border-amber-500 text-white'
                        : 'bg-violet-600 border-violet-600 text-white'
                    : 'bg-white dark:bg-slate-900/50 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-slate-300 dark:hover:border-slate-600'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </Field>

        {/* ── Workcode ── */}
        <Field label="Workcode" required>
          <Dropdown
            value={form.workcodeId}
            onChange={val => set('workcodeId', val)}
            opsi={opsiWorkcode}
            placeholder="— Pilih workcode —"
            searchable
          />
        </Field>

        {/* ── Jam Mulai & Selesai ── */}
        <Field label="Rentang Jam Eksekusi">
          <div className="flex items-center gap-2">
            <Input
              type="time"
              value={form.jamMulai}
              onChange={e => set('jamMulai', e.target.value)}
              className="flex-1"
            />
            <span className="text-slate-400 text-sm shrink-0">–</span>
            <Input
              type="time"
              value={form.jamSelesai}
              onChange={e => set('jamSelesai', e.target.value)}
              className="flex-1"
            />
          </div>
          <p className="text-[11px] text-slate-400 dark:text-slate-500 ml-1 mt-1">
            Preset hanya dieksekusi dalam rentang waktu ini.
          </p>
        </Field>

        {/* ── Hari Aktif ── */}
        <Field label="Hari Aktif">
          <div className="flex flex-wrap gap-1.5">
            {URUTAN_HARI.map(hari => {
              const aktif = form.hariAktif.includes(hari);
              return (
                <button
                  key={hari}
                  type="button"
                  onClick={() => toggleHari(hari)}
                  className={`px-3 py-1.5 rounded-full text-[11px] font-bold border transition-colors ${
                    aktif
                      ? 'bg-blue-600 border-blue-600 text-white'
                      : 'bg-white dark:bg-slate-900/50 border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:border-slate-300'
                  }`}
                >
                  {LABEL_HARI[hari]}
                </button>
              );
            })}
          </div>
        </Field>

        {/* ── Pool Lokasi ── */}
        <Field
          label="Pool Lokasi"
          hint={`${form.lokasiIds.length} dipilih / maks ${MAKS_LOKASI}`}
          required
        >
          {/* Search lokasi */}
          <div className="relative mb-2">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
            <Input
              placeholder="Cari nama/kode lokasi..."
              value={cariLokasi}
              onChange={e => setCariLokasi(e.target.value)}
              className="pl-9 text-sm"
            />
          </div>

          {/* Badge counter */}
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] text-slate-500 dark:text-slate-400">
              {form.lokasiIds.length > 0
                ? `${form.lokasiIds.length} lokasi dipilih`
                : 'Belum ada lokasi dipilih'}
            </span>
            {form.lokasiIds.length > 0 && (
              <button
                type="button"
                onClick={() => set('lokasiIds', [])}
                className="text-[11px] text-rose-500 hover:text-rose-600 font-medium"
              >
                Hapus semua
              </button>
            )}
          </div>

          {/* Daftar lokasi dengan checkbox */}
          <div className="max-h-44 overflow-y-auto custom-scrollbar rounded-xl border border-slate-200 dark:border-slate-700 divide-y divide-slate-100 dark:divide-slate-700/60">
            {lokasiFiltrat.length === 0 ? (
              <p className="py-6 text-center text-xs text-slate-400">
                {cariLokasi ? 'Tidak ada lokasi yang cocok.' : 'Belum ada lokasi tersimpan di perangkat.'}
              </p>
            ) : (
              lokasiFiltrat.map(lokasi => {
                const dipilih = form.lokasiIds.includes(lokasi.id);
                const dinonaktifkan =
                  !dipilih && form.lokasiIds.length >= MAKS_LOKASI;
                return (
                  <button
                    key={lokasi.id}
                    type="button"
                    disabled={dinonaktifkan}
                    onClick={() => toggleLokasi(lokasi.id)}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors ${
                      dipilih
                        ? 'bg-blue-50 dark:bg-blue-500/10'
                        : dinonaktifkan
                          ? 'opacity-40 cursor-not-allowed'
                          : 'hover:bg-slate-50 dark:hover:bg-slate-700/40'
                    }`}
                  >
                    {/* Kotak centang visual */}
                    <span
                      className={`w-4 h-4 rounded-md border-2 shrink-0 flex items-center justify-center transition-colors ${
                        dipilih
                          ? 'bg-blue-600 border-blue-600'
                          : 'border-slate-300 dark:border-slate-600'
                      }`}
                    >
                      {dipilih && (
                        <svg className="w-2.5 h-2.5 text-white" viewBox="0 0 10 10" fill="none">
                          <path
                            d="M1.5 5L4 7.5L8.5 2.5"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      )}
                    </span>
                    <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-xs font-semibold text-slate-700 dark:text-slate-200 truncate">
                        {lokasi.nama}
                      </span>
                      <span className="block text-[10px] text-slate-400 dark:text-slate-500">
                        {lokasi.latitude}, {lokasi.longitude}
                      </span>
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </Field>
      </div>
    </Modal>
  );
}
