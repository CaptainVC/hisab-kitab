export type Range = { from: string; to: string };

function pad2(n: number) { return String(n).padStart(2, '0'); }

export function currentQuarterRange(d = new Date()): Range {
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth() + 1; // 1-12
  const q = Math.floor((month - 1) / 3) + 1;
  const startMonth = (q - 1) * 3 + 1;
  const endMonth = startMonth + 2;
  return { from: `${year}-${pad2(startMonth)}`, to: `${year}-${pad2(endMonth)}` };
}
