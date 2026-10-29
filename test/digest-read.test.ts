import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { readNight } from '../src/digest/read.js';

describe('readNight on runs/2026-10-28.jsonl', () => {
  const digest = readNight('runs', '2026-10-28');

  it('has 5 jobs sorted by job and 1 bad line', () => {
    expect(digest).not.toBeNull();
    expect(digest!.rows.map((r) => r.job)).toEqual([
      'digest/render',
      'fixtures/refresh',
      'lane/sync',
      'notes/backup',
      'rig/rotate-logs',
    ]);
    expect(digest!.badLines).toBe(1);
    expect(digest!.counts).toEqual({ ok: 10, retry: 4, fail: 1 });
  });

  it('keeps the row with a null owner', () => {
    const row = digest!.rows.find((r) => r.job === 'digest/render');
    expect(row).toMatchObject({ owner: null, runs: 1, lastStatus: 'ok', lastError: null });
  });

  it('counts fixtures/refresh retries and keeps the offset', () => {
    const row = digest!.rows.find((r) => r.job === 'fixtures/refresh');
    expect(row).toEqual({
      job: 'fixtures/refresh',
      owner: 'rook',
      runs: 4,
      retries: 3,
      lastStatus: 'ok',
      lastError: null,
      firstAt: '2026-10-29T01:30:00+01:00',
      lastAt: '2026-10-29T01:37:00+01:00',
    });
  });

  it('shows notes/backup as fail with its error', () => {
    const row = digest!.rows.find((r) => r.job === 'notes/backup');
    expect(row).toMatchObject({ lastStatus: 'fail', lastError: 'quota exceeded', owner: 'lane-07' });
  });

  it('ignores the truncated last line for lane/sync', () => {
    const row = digest!.rows.find((r) => r.job === 'lane/sync');
    expect(row).toMatchObject({ runs: 8, retries: 1, lastAt: '2026-10-29T05:00:04+01:00' });
  });
});

describe('readNight edge cases', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rig-digest-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('returns null for a missing night', () => {
    expect(readNight(dir, '1999-01-01')).toBeNull();
  });

  it('reads an empty file as no rows', () => {
    writeFileSync(join(dir, '2026-01-01.jsonl'), '');
    expect(readNight(dir, '2026-01-01')).toEqual({
      night: '2026-01-01',
      rows: [],
      counts: { ok: 0, retry: 0, fail: 0 },
      badLines: 0,
    });
  });

  it('counts invalid lines without throwing, skips blank lines, orders by time', () => {
    const lines = [
      '{"at":"2026-01-02T02:00:00+01:00","job":"a","status":"fail","owner":"x","error":"boom"}',
      '{"at":"2026-01-02T01:00:00+01:00","job":"a","status":"ok","owner":"x"}',
      '[1,2]',
      '{"at":"2026-01-02T01:00:00+01:00","job":"a","status":"maybe","owner":"x"}',
      '{"at":"2026-01-02T01:00:00+01:00","job":"a","status":"ok","owner":7}',
      '{"job":"a","status":"ok","owner":null}',
      '',
    ];
    writeFileSync(join(dir, '2026-01-02.jsonl'), lines.join('\n') + '\n');
    const d = readNight(dir, '2026-01-02')!;
    expect(d.badLines).toBe(4);
    expect(d.rows).toEqual([
      {
        job: 'a',
        owner: 'x',
        runs: 2,
        retries: 0,
        lastStatus: 'fail',
        lastError: 'boom',
        firstAt: '2026-01-02T01:00:00+01:00',
        lastAt: '2026-01-02T02:00:00+01:00',
      },
    ]);
  });
});
