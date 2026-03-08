export function formatINR(n: number | string): string {
  const x = typeof n === 'string' ? Number(n) : n;
  const v = Number.isFinite(x) ? x : 0;
  try {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0
    }).format(v);
  } catch {
    return `₹${Math.round(v)}`;
  }
}
