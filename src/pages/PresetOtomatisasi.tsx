/**
 * Halaman Preset Otomatisasi Presensi.
 *
 * Menampilkan daftar preset, status penjadwal, dan tombol tambah/edit/hapus.
 * Menggunakan usePresetOtomatisasi dan useAutoPresensi di background.
 *
 * Layout mobile-first (360–414px) dengan Card per preset.
 */

import { useEffect, useState, useCallback } from 'react';
import {
  Zap,
  Plus,
  Pencil,
  Trash2,
  Power,
  PowerOff,
  Clock,
  MapPin,
  CalendarDays,
  ShieldCheck,
} from 'lucide-react';
import {
  PageHeader,
  Card,
  Badge,
  Alert,
  EmptyState,
  SkeletonList,
  ActionButton,
} from '../components/ui/Surface';
import { ConfirmDialog } from '../components/ui/Modal';
import PresetFormModal from '../components/PresetFormModal';
import { usePresetOtomatisasi } from '../hooks/usePresetOtomatisasi';
import { useServerContext } from '../hooks/useServerContext';
import { useToast } from '../components/ui/Toast';
import {
  LABEL_HARI,
  bacaLogHarian,
  type PresetOtomatisasi,
  type LogEksekusi,
} from '../lib/presetOtomatisasi';
import { getTodayWIB } from '../lib/dateFormatter';
import { rpcGetLokasiAbsen, rpcGetWorkCode } from '../lib/apiCalls';
import { useAppContext } from '../context/AppContext';
import type { LokasiView, WorkCodeView } from '../lib/viewModels';
import {
  getPenjadwalAktifStorage,
  setPenjadwalAktifStorage,
  notifyPresetUpdated,
} from '../components/GlobalPresetScheduler';
import {
  isAndroidPrabawa,
  requestAndroidBatteryOptimization,
} from '../lib/androidBackgroundBridge';

// ═══════════════════════════════════════════════════════════════════════
//  Tipe tipe→warna badge
// ═══════════════════════════════════════════════════════════════════════

function TipeBadge({ tipe }: { tipe: PresetOtomatisasi['tipe'] }) {
  if (tipe === 'datang') {
    return <Badge tone="emerald">Masuk</Badge>;
  }
  if (tipe === 'pulang') {
    return <Badge tone="amber">Pulang</Badge>;
  }
  return <Badge tone="violet">Custom</Badge>;
}

// ═══════════════════════════════════════════════════════════════════════
//  Kartu preset
// ═══════════════════════════════════════════════════════════════════════

function KartuPreset({
  preset,
  workcodeNama,
  lokasiCount,
  logTerakhir,
  onToggle,
  onEdit,
  onHapus,
}: {
  preset: PresetOtomatisasi;
  workcodeNama: string;
  lokasiCount: number;
  logTerakhir: string | null;
  onToggle: () => void;
  onEdit: () => void;
  onHapus: () => void;
}) {
  return (
    <Card className="space-y-3">
      {/* Header kartu */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-bold text-slate-800 dark:text-slate-100 truncate">
              {preset.nama}
            </p>
            <TipeBadge tipe={preset.tipe} />
            {preset.aktif ? (
              <Badge tone="emerald">Aktif</Badge>
            ) : (
              <Badge tone="slate">Nonaktif</Badge>
            )}
          </div>
        </div>
      </div>

      {/* Detail */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-2">
        {/* Jam */}
        <div className="flex items-center gap-1.5 col-span-2 sm:col-span-1">
          <Clock className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          <span className="text-xs text-slate-600 dark:text-slate-300">
            {preset.jamMulai} – {preset.jamSelesai}
          </span>
        </div>

        {/* Lokasi pool */}
        <div className="flex items-center gap-1.5 col-span-2 sm:col-span-1">
          <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          <span className="text-xs text-slate-600 dark:text-slate-300">
            {lokasiCount} lokasi dalam pool
          </span>
        </div>

        {/* Workcode */}
        {workcodeNama && (
          <div className="col-span-2">
            <span className="text-[11px] text-slate-400 dark:text-slate-500">
              Workcode: {workcodeNama}
            </span>
          </div>
        )}
      </div>

      {/* Hari aktif */}
      <div className="flex items-center gap-1.5">
        <CalendarDays className="w-3.5 h-3.5 text-slate-400 shrink-0" />
        <div className="flex flex-wrap gap-1">
          {([0, 1, 2, 3, 4, 5, 6] as Array<0 | 1 | 2 | 3 | 4 | 5 | 6>).map(h => (
            <span
              key={h}
              className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md ${
                preset.hariAktif.includes(h)
                  ? 'bg-blue-100 dark:bg-blue-500/15 text-blue-700 dark:text-blue-300'
                  : 'bg-slate-100 dark:bg-slate-700/50 text-slate-400 dark:text-slate-500'
              }`}
            >
              {LABEL_HARI[h]}
            </span>
          ))}
        </div>
      </div>

      {/* Log terakhir */}
      {logTerakhir && (
        <p className="text-[11px] text-slate-400 dark:text-slate-500 border-t border-slate-100 dark:border-slate-700/50 pt-2">
          Eksekusi terakhir: {logTerakhir}
        </p>
      )}

      {/* Tombol aksi */}
      <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-slate-100 dark:border-slate-700/50">
        <ActionButton
          variant={preset.aktif ? 'warning' : 'success'}
          size="sm"
          icon={preset.aktif ? <PowerOff className="w-3.5 h-3.5" /> : <Power className="w-3.5 h-3.5" />}
          onClick={onToggle}
        >
          {preset.aktif ? 'Nonaktifkan' : 'Aktifkan'}
        </ActionButton>
        <ActionButton
          variant="ghost"
          size="sm"
          icon={<Pencil className="w-3.5 h-3.5" />}
          onClick={onEdit}
        >
          Edit
        </ActionButton>
        <ActionButton
          variant="danger"
          size="sm"
          icon={<Trash2 className="w-3.5 h-3.5" />}
          onClick={onHapus}
        >
          Hapus
        </ActionButton>
      </div>
    </Card>
  );
}

// ═══════════════════════════════════════════════════════════════════════
//  Halaman utama
// ═══════════════════════════════════════════════════════════════════════

export default function PagePresetOtomatisasi() {
  const { currentUser } = useAppContext();
  const { context, ready } = useServerContext();
  const toast = useToast();
  const username = currentUser?.username ?? '';

  // ── State data dari server ──
  const [lokasis, setLokasis] = useState<LokasiView[]>([]);
  const [workcodes, setWorkcodes] = useState<WorkCodeView[]>([]);
  const [memuatData, setMemuatData] = useState(true);
  const [logsHarian, setLogsHarian] = useState<LogEksekusi[]>([]);

  // ── Hook preset ──
  const { presets, loading, tambahPreset, perbaruiPreset, hapusPreset, toggleAktif } =
    usePresetOtomatisasi();

  // ── State penjadwal aktif/tidak (disimpan persisten) ──
  const [penjadwalAktif, setPenjadwalAktif] = useState<boolean>(() => getPenjadwalAktifStorage());

  const handleTogglePenjadwal = () => {
    const baru = !penjadwalAktif;
    setPenjadwalAktif(baru);
    setPenjadwalAktifStorage(baru);
    toast.info(`Penjadwal presensi otomatis ${baru ? 'diaktifkan' : 'dinonaktifkan'}.`);
  };

  // ── State modal ──
  const [modalBuka, setModalBuka] = useState(false);
  const [presetDiedit, setPresetDiedit] = useState<PresetOtomatisasi | null>(null);
  const [hapusTarget, setHapusTarget] = useState<PresetOtomatisasi | null>(null);

  // ── Muat lokasi & workcode dari server ──
  useEffect(() => {
    if (!ready) return;
    let hidup = true;
    setMemuatData(true);
    void (async () => {
      try {
        const [lok, wc] = await Promise.all([
          rpcGetLokasiAbsen(context),
          rpcGetWorkCode(context),
        ]);
        if (!hidup) return;
        setLokasis(lok);
        setWorkcodes(wc);
      } catch {
        if (!hidup) return;
        toast.error('Gagal memuat data lokasi/workcode.');
      } finally {
        if (hidup) setMemuatData(false);
      }
    })();
    return () => { hidup = false; };
  }, [ready, context, toast]);

  // ── Muat log harian (async IndexedDB) ──
  const muatLogsHarian = useCallback(async () => {
    if (!username) { setLogsHarian([]); return; }
    try {
      const logs = await bacaLogHarian(username, getTodayWIB());
      setLogsHarian(logs);
    } catch {
      setLogsHarian([]);
    }
  }, [username]);

  useEffect(() => { void muatLogsHarian(); }, [muatLogsHarian]);

  // ── Handler modal ──
  const bukaModal = (preset?: PresetOtomatisasi) => {
    setPresetDiedit(preset ?? null);
    setModalBuka(true);
  };

  const tutupModal = () => {
    setModalBuka(false);
    setPresetDiedit(null);
  };

  const handleSimpan = async (data: Omit<PresetOtomatisasi, 'id' | 'dibuatPada' | 'diperbarui'>) => {
    if (presetDiedit) {
      await perbaruiPreset(presetDiedit.id, data);
      toast.success('Preset berhasil diperbarui.');
    } else {
      await tambahPreset(data);
      toast.success('Preset baru berhasil ditambahkan.');
    }
    notifyPresetUpdated();
    tutupModal();
  };

  const handleHapusKonfirmasi = async () => {
    if (!hapusTarget) return;
    await hapusPreset(hapusTarget.id);
    notifyPresetUpdated();
    toast.info(`Preset "${hapusTarget.nama}" dihapus.`);
    setHapusTarget(null);
  };

  const handleToggleAktif = async (presetId: string) => {
    await toggleAktif(presetId);
    notifyPresetUpdated();
  };

  // ── Bantu: nama workcode dari id ──
  const namaWorkcode = (workcodeId: string): string => {
    const wc = workcodes.find(w => String(w.id) === workcodeId);
    if (!wc) return workcodeId;
    return wc.nama;
  };

  // ── Bantu: log terakhir preset ──
  const logTerakhirPreset = (presetId: string): string | null => {
    const log = logsHarian.find(l => l.presetId === presetId);
    if (!log) return null;
    const jam = new Date(log.eksekusiPada).toLocaleTimeString('id-ID', {
      hour: '2-digit',
      minute: '2-digit',
    });
    return `${jam} WIB — ${log.berhasil ? '✅ Berhasil' : '❌ Gagal'}${log.pesan ? ` (${log.pesan})` : ''}`;
  };

  const sedangMemuat = loading || memuatData;

  return (
    <div className="space-y-5">
      {/* ── Header ── */}
      <PageHeader
        title="Preset Otomatisasi"
        subtitle="Konfigurasi absensi otomatis terjadwal"
        icon={<Zap className="w-5 h-5" />}
        action={
          <ActionButton
            variant="primary"
            size="sm"
            icon={<Plus className="w-4 h-4" />}
            onClick={() => bukaModal()}
            disabled={sedangMemuat || !ready}
          >
            Tambah Preset
          </ActionButton>
        }
      />

      {/* ── Info singkat fitur ── */}
      <Alert tone="blue">
        Fitur ini akan otomatis melakukan presensi sesuai jadwal yang ditentukan. Lokasi dipilih
        secara acak dari pool yang kamu pilih — pastikan semua lokasi dalam pool valid.
      </Alert>

      {/* ── Status penjadwal ── */}
      <Card padded={false} className="px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div
              className={`w-2 h-2 rounded-full ${penjadwalAktif ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'}`}
            />
            <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">
              Penjadwal{' '}
              <span
                className={
                  penjadwalAktif
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-slate-500 dark:text-slate-400'
                }
              >
                {penjadwalAktif ? 'Aktif' : 'Nonaktif'}
              </span>
            </span>
            <Badge tone={penjadwalAktif ? 'emerald' : 'slate'}>
              {penjadwalAktif ? 'ON' : 'OFF'}
            </Badge>
          </div>
          {/* Toggle switch */}
          <button
            type="button"
            role="switch"
            aria-checked={penjadwalAktif}
            onClick={handleTogglePenjadwal}
            className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500/40 ${
              penjadwalAktif ? 'bg-emerald-500' : 'bg-slate-200 dark:bg-slate-700'
            }`}
          >
            <span
              className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-sm ring-0 transition-transform duration-200 ease-in-out ${
                penjadwalAktif ? 'translate-x-5' : 'translate-x-0'
              }`}
            />
          </button>
        </div>
        {ready ? null : (
          <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1.5">
            Menunggu koneksi server…
          </p>
        )}
      </Card>

      {/* ── Banner optimasi baterai (khusus Android WebView) ── */}
      {isAndroidPrabawa() && (
        <Card padded={false} className="p-4 bg-blue-50/70 dark:bg-blue-950/20 border-blue-200/70 dark:border-blue-900/40">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <ShieldCheck className="w-5 h-5 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
              <div className="space-y-0.5 min-w-0">
                <p className="text-xs font-bold text-blue-900 dark:text-blue-200">
                  Layanan Latar Belakang Android (Tahan Kill)
                </p>
                <p className="text-[11px] text-blue-700/80 dark:text-blue-300/80 leading-relaxed">
                  Agar presensi otomatis tetap berjalan saat layar mati atau aplikasi di latar belakang, izinkan aplikasi mengabaikan penghemat baterai (Doze mode).
                </p>
              </div>
            </div>
            <ActionButton
              variant="secondary"
              size="sm"
              onClick={requestAndroidBatteryOptimization}
              className="shrink-0 text-xs py-1.5 px-3"
            >
              Izinkan
            </ActionButton>
          </div>
        </Card>
      )}

      {/* ── Daftar preset ── */}
      {sedangMemuat ? (
        <SkeletonList rows={3} />
      ) : presets.length === 0 ? (
        <EmptyState
          message="Belum ada preset otomatisasi"
          hint="Tekan tombol 'Tambah Preset' untuk membuat aturan absensi otomatis pertama kamu."
        />
      ) : (
        <div className="space-y-3">
          {presets.map(preset => (
            <KartuPreset
              key={preset.id}
              preset={preset}
              workcodeNama={namaWorkcode(preset.workcodeId)}
              lokasiCount={preset.lokasiIds.length}
              logTerakhir={logTerakhirPreset(preset.id)}
              onToggle={() => handleToggleAktif(preset.id)}
              onEdit={() => bukaModal(preset)}
              onHapus={() => setHapusTarget(preset)}
            />
          ))}
        </div>
      )}

      {/* ── Modal form tambah/edit ── */}
      <PresetFormModal
        buka={modalBuka}
        onTutup={tutupModal}
        onSimpan={handleSimpan}
        preset={presetDiedit}
        lokasis={lokasis}
        workcodes={workcodes}
      />

      {/* ── Dialog konfirmasi hapus ── */}
      <ConfirmDialog
        open={hapusTarget !== null}
        title="Hapus Preset?"
        message={
          <>
            Preset <strong>"{hapusTarget?.nama}"</strong> akan dihapus permanen. Tindakan ini
            tidak bisa dibatalkan.
          </>
        }
        confirmLabel="Ya, Hapus"
        tone="danger"
        onConfirm={handleHapusKonfirmasi}
        onCancel={() => setHapusTarget(null)}
      />
    </div>
  );
}
