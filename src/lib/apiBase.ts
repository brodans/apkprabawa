export function apiUrl(path: string): string {
  const configured = import.meta.env?.VITE_API_BASE_URL?.trim();
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  if (!configured) {
    if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
      throw new Error('VITE_API_BASE_URL wajib dikonfigurasi untuk aplikasi Tauri.');
    }
    return normalizedPath;
  }

  // Accept both `prabawa.vercel.app/` and a complete URL. Vite embeds the
  // value literally, while fetch requires an absolute URL in the APK.
  const base = /^[a-z][a-z\d+.-]*:\/\//i.test(configured)
    ? configured
    : `https://${configured}`;
  return `${base.replace(/\/$/, '')}${normalizedPath}`;
}
