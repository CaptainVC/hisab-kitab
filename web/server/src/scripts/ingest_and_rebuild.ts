import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadConfig } from '../config.js';

function run(cmd: string, args: string[]) {
  const r = spawnSync(cmd, args, { stdio: 'inherit' });
  if (r.status !== 0) {
    throw new Error(`command failed: ${cmd} ${args.join(' ')} (status ${r.status})`);
  }
}

function main() {
  const cfg = loadConfig();

  const from = process.env.HK_RANGE_FROM || '';
  const to = process.env.HK_RANGE_TO || '';
  if (!from || !to) throw new Error('HK_RANGE_FROM/HK_RANGE_TO required');

  const minConfidence = process.env.HK_MIN_CONFIDENCE || '0.85';
  const maxOrders = process.env.HK_MAX_ORDERS || '200';
  const maxPayments = process.env.HK_MAX_PAYMENTS || '500';
  const splitFromOrders = process.env.HK_SPLIT_FROM_ORDERS === '1';

  // repo root from this script location: web/server/dist/scripts
  const repoDir = path.resolve(path.join(import.meta.dirname, '..', '..', '..', '..'));

  const pollScript = path.join(repoDir, 'src', 'pipeline', 'poll_ingest.js');
  const dashScript = path.join(repoDir, 'src', 'dashboard', 'build_dashboard.js');

  const pollArgs = [
    pollScript,
    '--base-dir', cfg.baseDir,
    '--label', 'HisabKitab',
    '--min-confidence', String(minConfidence),
    '--max-orders', String(maxOrders),
    '--max-payments', String(maxPayments),
  ];
  if (splitFromOrders) pollArgs.push('--split-from-orders');

  run(process.execPath, pollArgs);

  const outJsonRel = path.join('cache', `hisab_data_${from}_${to}.json`);
  const outHtmlRel = path.join('cache', `hisab_dashboard_${from}_${to}.html`);

  run(process.execPath, [dashScript, cfg.baseDir, outJsonRel, outHtmlRel]);
}

main();
