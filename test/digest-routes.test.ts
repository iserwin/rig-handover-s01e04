import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { Digest } from '../src/digest/types.js';

const base = { adapter: 'shim', installed: '2026-10-29T14:06:00+01:00', beatEverySeconds: 60 };

const run = (at: string, job: string, status: string, owner: string | null, error?: string) =>
  JSON.stringify({ at, job, status, owner, ...(error ? { error } : {}) });

// Deliberately not in job order, so the sort is exercised.
const goodLines = [
  run('2026-10-20T23:00:01+01:00', 'zeta/sync', 'ok', 'rook'),
  run('2026-10-20T23:10:00+01:00', 'beta/orphan', 'ok', null),
  run('2026-10-20T23:20:00+01:00', 'gamma/flaky', 'retry', 'rook', 'upstream 503'),
  run('2026-10-20T23:21:00+01:00', 'gamma/flaky', 'retry', 'rook', 'upstream 503'),
  run('2026-10-20T23:22:00+01:00', 'gamma/flaky', 'retry', 'rook', 'upstream 503'),
  run('2026-10-20T23:23:00+01:00', 'gamma/flaky', 'ok', 'rook'),
  run('2026-10-21T01:00:00+01:00', 'alpha/backup', 'fail', 'lane-07', 'quota exceeded'),
];
const normalJobs = ['zeta/sync', 'beta/orphan', 'gamma/flaky', 'alpha/backup'];

let dir: string;
let app: ReturnType<typeof createApp>;

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rig-digest-'));
  fs.writeFileSync(path.join(dir, '2026-10-20.jsonl'), goodLines.join('\n') + '\n');
  fs.writeFileSync(path.join(dir, '2026-10-21.jsonl'), '');
  const truncated = run('2026-10-22T03:00:00+01:00', 'omega/cut', 'ok', 'rook').slice(0, 30);
  fs.writeFileSync(
    path.join(dir, '2026-10-22.jsonl'),
    [
      run('2026-10-22T01:00:00+01:00', 'zeta/sync', 'ok', 'rook'),
      run('2026-10-22T02:00:00+01:00', 'alpha/backup', 'ok', 'lane-07'),
      truncated,
    ].join('\n'),
  );
  app = createApp({ ...base, runsDir: dir });
});

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

// Order in which the jobs first appear in the rendered page.
function pageOrder(html: string, jobs: string[]): string[] {
  const found = jobs.map((job) => ({ job, at: html.indexOf(job) }));
  for (const f of found) expect(f.at, `${f.job} missing from page`).toBeGreaterThanOrEqual(0);
  return found.sort((a, b) => a.at - b.at).map((f) => f.job);
}

async function getJson(a: ReturnType<typeof createApp>, night: string) {
  const res = await a.request(`/api/digest/${night}`);
  return { res, digest: (await res.json()) as Digest };
}

describe('digest routes: normal night', () => {
  it('page answers 200 and lists every job', async () => {
    const res = await app.request('/digest/2026-10-20');
    const html = await res.text();
    expect(res.status).toBe(200);
    for (const job of normalJobs) expect(html).toContain(job);
  });

  it('json answers 200 with one row per job, sorted by job', async () => {
    const { res, digest } = await getJson(app, '2026-10-20');
    expect(res.status).toBe(200);
    expect(digest.night).toBe('2026-10-20');
    expect(digest.badLines).toBe(0);
    expect(digest.rows.map((r) => r.job)).toEqual([...normalJobs].sort());
    expect(digest.rows.find((r) => r.job === 'beta/orphan')?.owner).toBeNull();
    expect(digest.rows.find((r) => r.job === 'gamma/flaky')?.retries).toBe(3);
    expect(digest.rows.find((r) => r.job === 'alpha/backup')?.lastStatus).toBe('fail');
  });

  it('page and json list the same jobs in the same order', async () => {
    const html = await (await app.request('/digest/2026-10-20')).text();
    const { digest } = await getJson(app, '2026-10-20');
    const jobs = digest.rows.map((r) => r.job);
    expect(pageOrder(html, jobs)).toEqual(jobs);
  });
});

describe('digest routes: no file', () => {
  it('page is 404', async () => {
    const res = await app.request('/digest/2026-01-01');
    expect(res.status).toBe(404);
  });

  it('page is 404 for a bad night format', async () => {
    const res = await app.request('/digest/not-a-night');
    expect(res.status).toBe(404);
  });

  it('json is 404 with an error body', async () => {
    const res = await app.request('/api/digest/2026-01-01');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not found' });
  });
});

describe('digest routes: empty night', () => {
  it('page says nothing ran', async () => {
    const res = await app.request('/digest/2026-10-21');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('nothing ran');
  });

  it('json has no rows', async () => {
    const { res, digest } = await getJson(app, '2026-10-21');
    expect(res.status).toBe(200);
    expect(digest.rows).toEqual([]);
    expect(digest.badLines).toBe(0);
  });
});

describe('digest routes: night with a bad line', () => {
  it('json counts the bad line and keeps the good jobs', async () => {
    const { res, digest } = await getJson(app, '2026-10-22');
    expect(res.status).toBe(200);
    expect(digest.badLines).toBe(1);
    expect(digest.rows.map((r) => r.job)).toEqual(['alpha/backup', 'zeta/sync']);
  });

  it('page still renders the good jobs', async () => {
    const res = await app.request('/digest/2026-10-22');
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('alpha/backup');
    expect(html).toContain('zeta/sync');
    expect(html).not.toContain('omega/cut');
  });
});

describe('digest routes: real night runs/2026-10-28', () => {
  it('page and json list the same 5 jobs in the same order', async () => {
    const real = createApp({ ...base, runsDir: 'runs' });
    const pageRes = await real.request('/digest/2026-10-28');
    const html = await pageRes.text();
    expect(pageRes.status).toBe(200);
    const { res, digest } = await getJson(real, '2026-10-28');
    expect(res.status).toBe(200);
    const jobs = digest.rows.map((r) => r.job);
    expect(jobs).toHaveLength(5);
    expect(pageOrder(html, jobs)).toEqual(jobs);
  });
});
