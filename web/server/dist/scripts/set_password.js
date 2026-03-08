import { loadConfig } from '../config.js';
import { setPassword, ensureAuthFile } from '../auth/authStore.js';
async function main() {
    const cfg = loadConfig();
    const pw = process.env.HK_ADMIN_PASSWORD || '';
    if (!pw || pw.length < 8) {
        throw new Error('Set HK_ADMIN_PASSWORD env var (min 8 chars)');
    }
    await ensureAuthFile(cfg.authFile);
    await setPassword(cfg.authFile, pw);
    process.stdout.write(JSON.stringify({ ok: true, authFile: cfg.authFile }, null, 2) + '\n');
}
main().catch((e) => {
    console.error(e);
    process.exit(1);
});
//# sourceMappingURL=set_password.js.map