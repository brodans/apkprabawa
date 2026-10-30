export function apiUrl(path: string): string {
  const configured = import.meta.env?.VITE_API_BASE_URL?.trim();
  const fallback = 'https://prabawa.vercel.app';
  if (!configured) return `${fallback}${path.startsWith('/') ? path : `/${path}`}`;

  // Accept both `prabawa.vercel.app/` and a complete URL. Vite embeds the
  // value literally, while fetch requires an absolute URL in the APK.
  const base = /^[a-z][a-z\d+.-]*:\/\//i.test(configured)
    ? configured
    : `https://${configured}`;
  return `${base.replace(/\/$/, '')}${path.startsWith('/') ? path : `/${path}`}`;
}
