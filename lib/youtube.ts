export function extractYouTubeId(input: string): string | null {
  if (!input) return null;
  const s = input.trim();

  if (/^[a-zA-Z0-9_-]{11}$/.test(s)) return s;

  try {
    const normalized = s.startsWith('http') ? s : `https://${s}`;
    const url = new URL(normalized);
    const host = url.hostname.replace(/^www\./, '').toLowerCase();

    if (host === 'youtu.be') {
      const id = url.pathname.slice(1);
      return /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : null;
    }

    if (host.endsWith('youtube.com')) {
      if (url.pathname === '/watch') {
        const id = url.searchParams.get('v') ?? '';
        return /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : null;
      }
      const parts = url.pathname.split('/').filter(Boolean);
      if (parts.length >= 2) {
        const cand = parts[1];
        if (['shorts', 'embed', 'live', 'v'].includes(parts[0])) {
          return /^[a-zA-Z0-9_-]{11}$/.test(cand) ? cand : null;
        }
      }
    }
  } catch {
    // ignore
  }
  return null;
}