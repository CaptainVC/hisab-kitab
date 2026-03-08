import argon2 from 'argon2';
import { readJson, writeJson } from '../storage/jsonStore.js';
export async function ensureAuthFile(authFile) {
    const cur = readJson(authFile, null);
    if (cur && cur.hash)
        return;
    // Default password must be set by user; we initialize with a random impossible hash.
    const hash = await argon2.hash('CHANGE_ME_' + Date.now(), { type: argon2.argon2id });
    writeJson(authFile, { algorithm: 'argon2id', hash });
}
export async function verifyPassword(authFile, password) {
    const cur = readJson(authFile, null);
    if (!cur?.hash)
        return false;
    try {
        return await argon2.verify(cur.hash, password);
    }
    catch {
        return false;
    }
}
export async function setPassword(authFile, password) {
    const hash = await argon2.hash(password, { type: argon2.argon2id });
    writeJson(authFile, { algorithm: 'argon2id', hash });
}
//# sourceMappingURL=authStore.js.map