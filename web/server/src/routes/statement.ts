import type { FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { requireAuth } from '../auth/session.js';
import { rangeKey } from '../utils/rangeKey.js';

function cachePath(cacheDir: string, from: string, to: string) {
  const key = rangeKey(from, to);
  return path.join(cacheDir, `hisab_data_${key}.json`);
}

function parseAmount(s: string) {
  const t = String(s || '').replace(/,/g, '').trim();
  if (!t) return null;
  const n = Number(t);
  if (!Number.isFinite(n)) return null;
  return n;
}

function parseStatementTextToRows(txt: string) {
  // Very lightweight parser for HDFC statement-style text.
  // We look for any line containing a date + amount, and keep the whole line as narration.
  // Date formats commonly: DD/MM/YY or DD/MM/YYYY.
  const lines = String(txt || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  const out: Array<{ date: string; amount: number; narration: string; rawLine: string }>=[];
  const dateRe = /(\b\d{2}\/\d{2}\/(?:\d{2}|\d{4})\b)/;

  for (const line of lines) {
    const m = line.match(dateRe);
    if (!m) continue;

    // Find last numeric token as amount.
    const nums = line.match(/-?\d{1,3}(?:,\d{3})*(?:\.\d+)?/g);
    if (!nums || !nums.length) continue;
    const amt = parseAmount(nums[nums.length - 1]);
    if (amt === null) continue;

    const ddmmyy = m[1];
    const [dd, mm, yy0] = ddmmyy.split('/');
    const yy = yy0.length === 2 ? `20${yy0}` : yy0;
    const iso = `${yy}-${mm}-${dd}`;

    out.push({ date: iso, amount: amt, narration: line, rawLine: line });
  }

  return out;
}

export async function registerStatementRoutes(
  app: FastifyInstance,
  opts: { baseDir: string; cacheDir: string; repoDir: string }
) {
  await app.register(multipart, {
    limits: { fileSize: 25 * 1024 * 1024 }
  });

  app.post('/api/v1/statement/match', async (req, reply) => {
    if (!requireAuth(req, reply)) return;

    const q = req.query as any;
    const from = String(q.from || '');
    const to = String(q.to || '');
    if (!from || !to) return reply.code(400).send({ ok: false, error: 'missing_range' });

    const fp = cachePath(opts.cacheDir, from, to);
    if (!fs.existsSync(fp)) {
      return reply.code(404).send({ ok: false, error: 'cache_missing', cacheFile: fp });
    }
    const data = JSON.parse(fs.readFileSync(fp, 'utf8')) as any;
    const hkRows = Array.isArray(data?.rows) ? data.rows : [];

    const part = await (req as any).file();
    if (!part) return reply.code(400).send({ ok: false, error: 'missing_file' });

    const filename = String(part.filename || 'statement.pdf');
    if (!filename.toLowerCase().endsWith('.pdf')) {
      return reply.code(400).send({ ok: false, error: 'bad_file_type', detail: 'only_pdf' });
    }

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hk_stmt_'));
    const pdfPath = path.join(tmpDir, 'statement.pdf');

    // write upload
    await new Promise<void>((resolve, reject) => {
      const ws = fs.createWriteStream(pdfPath);
      part.file.pipe(ws);
      part.file.on('error', reject);
      ws.on('error', reject);
      ws.on('finish', () => resolve());
    });

    try {
      const txtPath = path.join(tmpDir, 'statement.txt');
      const r = spawnSync('pdftotext', ['-layout', pdfPath, txtPath], { encoding: 'utf8' });
      if (r.status !== 0) {
        return reply.code(500).send({ ok: false, error: 'pdftotext_failed', detail: String(r.stderr || r.stdout || '') });
      }

      const txt = fs.readFileSync(txtPath, 'utf8');
      const stmtRows = parseStatementTextToRows(txt);

      const daysWindow = 2;
      function dayDiff(a: string, b: string) {
        const da = Date.parse(a + 'T00:00:00Z');
        const db = Date.parse(b + 'T00:00:00Z');
        if (!Number.isFinite(da) || !Number.isFinite(db)) return 9999;
        return Math.round(Math.abs(da - db) / 86400000);
      }

      const matches = stmtRows.map((s, idx) => {
        const candidates = hkRows
          .filter((r: any) => {
            const d = String(r.date || '');
            const amt = Number(r.amount || 0);
            if (!d) return false;
            if (Math.abs(Number(s.amount) - amt) > 0.01) return false;
            if (dayDiff(d, s.date) > daysWindow) return false;
            return true;
          })
          .slice(0, 10)
          .map((r: any) => ({ txn_id: r.txn_id, date: r.date, amount: r.amount, raw_text: r.raw_text || '', type: r.type || '' }));

        return {
          idx,
          date: s.date,
          amount: s.amount,
          narration: s.narration,
          candidates
        };
      });

      const matched = matches.filter((m) => m.candidates.length > 0).length;
      const exact1 = matches.filter((m) => m.candidates.length === 1).length;

      return reply.send({
        ok: true,
        parsed: stmtRows.length,
        matched,
        exact1,
        daysWindow,
        results: matches
      });
    } finally {
      // auto-delete temp folder
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    }
  });
}
