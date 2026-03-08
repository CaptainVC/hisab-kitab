export type Range = { from: string; to: string };

function pad2(n: number) { return String(n).padStart(2, '0'); }

export function defaultRange(d = new Date()): Range {
  // Default: first day of current year → today
  const year = d.getUTCFullYear();
  const from = `${year}-01-01`;
  const to = d.toISOString().slice(0, 10);
  return { from, to };
}

const KEY = 'hk:range';

export function loadRange(): Range {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const j = JSON.parse(raw);
      if (j && typeof j.from === 'string' && typeof j.to === 'string') {
        let from = j.from;
        let to = j.to;

        // Back-compat: older stored values may be month ranges (YYYY-MM)
        if (/^\d{4}-\d{2}$/.test(from)) from = `${from}-01`;
        if (/^\d{4}-\d{2}$/.test(to)) {
          const [ty, tm] = to.split('-').map(Number);
          to = new Date(Date.UTC(ty, tm, 0)).toISOString().slice(0, 10);
        }

        return { from, to };
      }
    }
  } catch {}
  return defaultRange();
}

export function saveRange(r: Range) {
  try {
    localStorage.setItem(KEY, JSON.stringify(r));
  } catch {}
}
