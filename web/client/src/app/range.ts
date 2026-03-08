export type Range = { from: string; to: string };

function pad2(n: number) { return String(n).padStart(2, '0'); }

export function currentQuarterRange(d = new Date()): Range {
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth() + 1; // 1-12
  const q = Math.floor((month - 1) / 3) + 1;
  const startMonth = (q - 1) * 3 + 1;
  const endMonth = startMonth + 2;

  const from = `${year}-${pad2(startMonth)}-01`;
  const lastDay = new Date(Date.UTC(year, endMonth, 0)).toISOString().slice(0, 10); // last day of endMonth
  return { from, to: lastDay };
}

const KEY = 'hk:range';

export function loadRange(): Range {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const j = JSON.parse(raw);
      if (j && typeof j.from === 'string' && typeof j.to === 'string') return { from: j.from, to: j.to };
    }
  } catch {}
  return currentQuarterRange();
}

export function saveRange(r: Range) {
  try {
    localStorage.setItem(KEY, JSON.stringify(r));
  } catch {}
}
