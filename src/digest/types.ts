// Plan morning-digest § 1. The contract every part of § 2 builds against.

export type RunStatus = 'ok' | 'retry' | 'fail';

// One line of runs/<night>.jsonl, after parsing.
export type RunLine = {
  at: string;
  job: string;
  status: RunStatus;
  owner: string | null;
  error?: string;
};

// One row per job. Times keep the offset from the log (styleguide); owner `null` renders as `—`.
export type DigestRow = {
  job: string;
  owner: string | null;
  runs: number;
  retries: number;
  lastStatus: RunStatus;
  lastError: string | null;
  firstAt: string;
  lastAt: string;
};

// Rows sorted by job. `badLines` counts lines that didn't parse; they are never thrown.
export type Digest = {
  night: string;
  rows: DigestRow[];
  badLines: number;
};

// Returns null when runs/<night>.jsonl doesn't exist (the routes answer 404).
// An empty file gives `rows: []`.
export type ReadNight = (runsDir: string, night: string) => Digest | null;
