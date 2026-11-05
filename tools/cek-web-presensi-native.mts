/**
 * Verifikasi jembatan captcha native Tauri tanpa menghubungi server pusat.
 */
const panggilan: Array<Record<string, unknown>> = [];
let statusHalamanLogin = 200;
const state = {
  __TAURI_INTERNALS__: {
    invoke: async (command: string, args: Record<string, unknown>) => {
      panggilan.push({ command, ...args });
      if (command !== 'web_presensi_request') throw new Error(`Command tak dikenal: ${command}`);
      if (args.path === '/ep/p/') {
        return { status: statusHalamanLogin, contentType: 'text/html', body: '<html>login</html>' };
      }
      if (args.path === '/ep/p/login') {
        return { status: 200, contentType: 'text/html', body: '<html>login berhasil</html>' };
      }
      return {
        status: 200,
        contentType: 'image/png',
        body: null,
        bodyBase64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l2cAAAAASUVORK5CYII=',
      };
    },
  },
  location: { origin: 'tauri://localhost' },
};
globalThis.window = state as unknown as Window & typeof globalThis;

let fail = 0;
const cek = (nama: string, ok: unknown, detail = '') => {
  if (!ok) fail++;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${nama}${detail ? ` — ${detail}` : ''}`);
};

const { login, muatCaptcha } = await import('../src/lib/webPresensi.ts');
const hasil = await muatCaptcha();
cek('captcha didapat sebagai object URL gambar', hasil.url.startsWith('blob:'));
cek('dua request berjalan lewat command native',
  panggilan.length === 2 && panggilan.every(item => item.command === 'web_presensi_request'));
cek('request pertama membuat sesi di origin native',
  panggilan[0]?.path === '/ep/p/');
cek('captcha diminta lewat path yang akan dipetakan Rust',
  typeof panggilan[1]?.path === 'string' &&
    String(panggilan[1].path).startsWith('/ep/p/captcha?') &&
    String(panggilan[1].path).includes('reload=1'));
cek('User-Agent dan bahasa WebView ikut dikirim',
  panggilan.every(item => typeof item.userAgent === 'string' && typeof item.acceptLanguage === 'string'));
const berhasilLogin = await login({ nip: '198501012015011001', password: 'sandi uji', captcha: '1234' });
const kirimLogin = panggilan.find(item => item.path === '/ep/p/login');
const formLogin = new URLSearchParams(String(kirimLogin?.body ?? ''));
cek('login Web berhasil melalui command native', berhasilLogin && kirimLogin?.command === 'web_presensi_request');
cek('form login Web diteruskan ke host native', kirimLogin?.method === 'POST' &&
  formLogin.get('m_user[email]') === '198501012015011001' &&
  formLogin.get('m_user[password]') === 'sandiuji' &&
  formLogin.get('m_user[CAPTCHA]') === '1234');

const jumlahSebelumDitolak = panggilan.length;
statusHalamanLogin = 403;
let pesanCaptchaDitolak = '';
try {
  await muatCaptcha();
} catch (error) {
  pesanCaptchaDitolak = error instanceof Error ? error.message : String(error);
}
cek('server menolak halaman Web Presensi dengan pesan yang jelas',
  pesanCaptchaDitolak.includes('HTTP 403'));
cek('captcha tidak diminta ketika sesi halaman login ditolak',
  panggilan.length === jumlahSebelumDitolak + 1);

URL.revokeObjectURL(hasil.url);
console.log(fail === 0 ? '\nSEMUA LULUS' : `\n${fail} KEGAGALAN`);
process.exit(fail === 0 ? 0 : 1);
