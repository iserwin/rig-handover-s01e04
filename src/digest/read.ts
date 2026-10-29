import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Digest, DigestRow, ReadNight, RunLine, RunStatus } from './types.js';

const STATUSES: readonly RunStatus[] = ['ok', 'retry', 'fail'];

function isStatus(value: unknown): value is RunStatus {
  return typeof value === 'string' && (STATUSES as readonly string[]).includes(value);
}

// Parse one non-blank line at the edge. Returns null for anything that isn't a valid RunLine.
export function parseRunLine(text: string): RunLine | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const { at, job, status, owner, error } = raw as Record<string, unknown>;
  if (typeof at !== 'string' || Number.isNaN(Date.parse(at))) return null;
  if (typeof job !== 'string' || job === '') return null;
  if (!isStatus(status)) return null;
  if (owner !== null && typeof owner !== 'string') return null;
  if (error !== undefined && typeof error !== 'string') return null;
  const line: RunLine = { at, job, status, owner };
  if (error !== undefined) line.error = error;
  return line;
}

type Entry = { line: RunLine; ms: number };

function toRow(job: string, entries: Entry[]): DigestRow {
  // Stable sort by instant: ties keep file order. Raw `at` strings are kept (never converted).
  const byTime = [...entries].sort((a, b) => a.ms - b.ms);
  const first = byTime[0]!.line;
  const last = byTime[byTime.length - 1]!.line;
  return {
    job,
    owner: last.owner,
    runs: entries.length,
    retries: entries.filter((e) => e.line.status === 'retry').length,
    lastStatus: last.status,
    lastError: last.error ?? null,
    firstAt: first.at,
    lastAt: last.at,
  };
}

export const readNight: ReadNight = (runsDir, night) => {
  const path = join(runsDir, `${night}.jsonl`);
  if (!existsSync(path)) return null;

  const counts: Record<RunStatus, number> = { ok: 0, retry: 0, fail: 0 };
  const byJob = new Map<string, Entry[]>();
  let badLines = 0;

  for (const text of readFileSync(path, 'utf8').split(/\r?\n/)) {
    if (text.trim() === '') continue;
    const line = parseRunLine(text);
    if (!line) {
      badLines += 1;
      continue;
    }
    counts[line.status] += 1;
    const entries = byJob.get(line.job) ?? [];
    entries.push({ line, ms: Date.parse(line.at) });
    byJob.set(line.job, entries);
  }

  const rows = [...byJob.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([job, entries]) => toRow(job, entries));

  const digest: Digest = { night, rows, counts, badLines };
  return digest;
};
