export function parseRangeToMs(from, to) {
    const f = String(from || '').trim();
    const t = String(to || '').trim();
    // Month range: YYYY-MM (inclusive months)
    if (/^\d{4}-\d{2}$/.test(f) && /^\d{4}-\d{2}$/.test(t)) {
        const [fy, fm] = f.split('-').map(Number);
        const [ty, tm] = t.split('-').map(Number);
        if (!fy || !fm || !ty || !tm)
            return null;
        const start = Date.UTC(fy, fm - 1, 1, 0, 0, 0, 0);
        const endExclusive = Date.UTC(ty, tm, 1, 0, 0, 0, 0);
        return { start, endExclusive };
    }
    // Date range: YYYY-MM-DD (inclusive dates)
    if (/^\d{4}-\d{2}-\d{2}$/.test(f) && /^\d{4}-\d{2}-\d{2}$/.test(t)) {
        const start = Date.parse(f + 'T00:00:00Z');
        const endInc = Date.parse(t + 'T00:00:00Z');
        if (!Number.isFinite(start) || !Number.isFinite(endInc))
            return null;
        const endExclusive = endInc + 24 * 60 * 60 * 1000;
        return { start, endExclusive };
    }
    return null;
}
//# sourceMappingURL=range.js.map