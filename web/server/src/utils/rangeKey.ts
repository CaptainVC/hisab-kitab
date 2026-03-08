export function rangeKey(from: string, to: string): string {
  const f = String(from || '').trim();
  const t = String(to || '').trim();

  // If both are full dates, key by month (prevents daily cache misses when using "today" as end date).
  if (/^\d{4}-\d{2}-\d{2}$/.test(f) && /^\d{4}-\d{2}-\d{2}$/.test(t)) {
    return `${f.slice(0, 7)}_${t.slice(0, 7)}`;
  }

  // Month keys already stable.
  if (/^\d{4}-\d{2}$/.test(f) && /^\d{4}-\d{2}$/.test(t)) {
    return `${f}_${t}`;
  }

  // Fallback: sanitize
  const safe = (s: string) => s.replace(/[^0-9A-Za-z_-]/g, '_');
  return `${safe(f)}_${safe(t)}`;
}
