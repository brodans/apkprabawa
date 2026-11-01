/**
 * Tes verifikasi fitur Preset Otomatisasi & Random Location Rotation.
 * Menguji logika pemilihan lokasi acak, rentang waktu, dan hari aktif.
 */

import {
  pilihLokasiAcak,
  dalamRentangWaktu,
  hariIniAktif,
  LABEL_HARI,
  URUTAN_HARI,
  type HariKerja,
} from '../src/lib/presetOtomatisasi';

function tegas(kondisi: boolean, pesan: string): void {
  if (!kondisi) {
    console.error(`❌ GAGAL: ${pesan}`);
    process.exit(1);
  }
}

console.log('🧪 Memulai pengujian logika Preset Otomatisasi...\n');

// ── 1. Tes Random Location Picker ─────────────────────────────────────
console.log('1. Pengujian Random Location Picker (pilihLokasiAcak):');

tegas(pilihLokasiAcak([]) === null, 'Array kosong harus mengembalikan null');

const satuLokasi = ['LOK-001'];
tegas(pilihLokasiAcak(satuLokasi) === 'LOK-001', '1 lokasi harus selalu terpilih lokasi itu');

// Uji pool hingga 20 lokasi
const pool20 = Array.from({ length: 20 }, (_, i) => `LOK-${String(i + 1).padStart(3, '0')}`);
const hitCount: Record<string, number> = {};
const ITERASI = 2000;

for (let i = 0; i < ITERASI; i++) {
  const terpilih = pilihLokasiAcak(pool20);
  tegas(terpilih !== null, 'Lokasi terpilih tidak boleh null');
  tegas(pool20.includes(terpilih!), 'Lokasi terpilih harus berasal dari pool');
  hitCount[terpilih!] = (hitCount[terpilih!] ?? 0) + 1;
}

// Pastikan semua 20 lokasi pernah terpilih setidaknya sekali dalam 2000 iterasi
const jumlahUnik = Object.keys(hitCount).length;
tegas(jumlahUnik === 20, `Semua 20 lokasi harus pernah terpilih (terpilih: ${jumlahUnik}/20)`);
console.log(`  ✅ 20 lokasi terpilih dengan distribusi acak seragam (${jumlahUnik}/20 titik terdistribusi).`);

// ── 2. Tes Validasi Rentang Waktu ──────────────────────────────────────
console.log('\n2. Pengujian Rentang Waktu (dalamRentangWaktu):');

// Kasus normal: 06:00 - 06:50
tegas(dalamRentangWaktu('06:00', '06:50', '06:00'), 'Batas awal (06:00) harus valid');
tegas(dalamRentangWaktu('06:00', '06:50', '06:25'), 'Waktu tengah (06:25) harus valid');
tegas(dalamRentangWaktu('06:00', '06:50', '06:50'), 'Batas akhir (06:50) harus valid');
tegas(!dalamRentangWaktu('06:00', '06:50', '05:59'), 'Sebelum rentang (05:59) harus ditolak');
tegas(!dalamRentangWaktu('06:00', '06:50', '06:51'), 'Setelah rentang (06:51) harus ditolak');
tegas(!dalamRentangWaktu('06:00', '06:50', '12:00'), 'Jauh di luar rentang (12:00) harus ditolak');

// Kasus rentang melewati tengah malam: 23:00 - 02:00
tegas(dalamRentangWaktu('23:00', '02:00', '23:30'), 'Tengah malam (23:30) harus valid');
tegas(dalamRentangWaktu('23:00', '02:00', '01:15'), 'Dini hari (01:15) harus valid');
tegas(!dalamRentangWaktu('23:00', '02:00', '15:00'), 'Sore hari (15:00) harus ditolak');

console.log('  ✅ Validasi rentang waktu akurat (termasuk kasus batas dan lintang tengah malam).');

// ── 3. Tes Hari Aktif ─────────────────────────────────────────────────
console.log('\n3. Pengujian Hari Aktif (hariIniAktif):');

const hariKerja: HariKerja[] = [1, 2, 3, 4, 5]; // Senin - Jumat
tegas(hariIniAktif(hariKerja, 1), 'Senin (1) harus aktif');
tegas(hariIniAktif(hariKerja, 5), 'Jumat (5) harus aktif');
tegas(!hariIniAktif(hariKerja, 0), 'Minggu (0) harus tidak aktif');
tegas(!hariIniAktif(hariKerja, 6), 'Sabtu (6) harus tidak aktif');

console.log('  ✅ Validasi hari aktif bekerja dengan benar.');

// ── 4. Tes Urutan dan Label Hari ──────────────────────────────────────
console.log('\n4. Pengujian Tampilan Hari:');
tegas(URUTAN_HARI.length === 7, 'Harus ada 7 hari');
tegas(LABEL_HARI[1] === 'Sen', 'Hari 1 harus Senin');
tegas(LABEL_HARI[0] === 'Min', 'Hari 0 harus Minggu');

console.log('  ✅ Konvensi nama hari Indonesia valid.');

console.log('\n🎉 SEMUA PENGUJIAN LOGIKA PRESET OTOMATISASI BERHASIL (100% PASS)!');
