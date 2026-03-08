import { readJson, writeJson } from '../storage/jsonStore.js';
export function loadReviewState(filePath) {
    return readJson(filePath, { schemaVersion: 1, resolvedTxnIds: {} });
}
export function saveReviewState(filePath, st) {
    writeJson(filePath, st);
}
//# sourceMappingURL=reviewState.js.map