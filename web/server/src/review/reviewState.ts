import { readJson, writeJson } from '../storage/jsonStore.js';

export type ReviewState = {
  schemaVersion: 1;
  resolvedTxnIds: Record<string, { resolvedAt: string; note?: string }>;
};

export function loadReviewState(filePath: string): ReviewState {
  return readJson<ReviewState>(filePath, { schemaVersion: 1, resolvedTxnIds: {} });
}

export function saveReviewState(filePath: string, st: ReviewState) {
  writeJson(filePath, st);
}
