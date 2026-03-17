# Pipeline Runner Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a cross-project resilient pipeline runner with Node.js module, known-issues catalog, Claude Code skill, and CARL domain integration.

**Architecture:** Two components share a known-issues catalog in `~/.carl/pipeline-runner/`. The Node.js module wraps step functions with timeout/retry/catalog-matching for automated pipelines. The Claude Code skill provides behavioral guardrails for interactive workflows. A CARL domain auto-loads the skill on keyword match.

**Tech Stack:** Node.js (ESM), fs/path/os/url stdlib, Promise.race for timeouts, regex for pattern matching

**Semantics note:** `maxRetries` means retries *after* the original attempt. So `maxRetries: 2` = 3 total attempts (1 original + 2 retries). The spec's "(including original)" phrasing was a documentation error — the name `maxRetries` is authoritative.

**Spec:** `docs/superpowers/specs/2026-03-17-pipeline-runner-design.md`

---

## Chunk 1: Core Pipeline Runner Module

### Task 1: Create directory structure and known-issues catalog

**Files:**
- Create: `~/.carl/pipeline-runner/known-issues.json`
- Create: `~/.carl/pipeline-runner/logs/` (directory)

- [ ] **Step 1: Create directories**

```bash
mkdir -p ~/.carl/pipeline-runner/logs
```

- [ ] **Step 2: Write initial known-issues.json with 6 verified entries**

Write to `~/.carl/pipeline-runner/known-issues.json`:

```json
{
  "version": 1,
  "issues": [
    {
      "id": "nlm-cookie-expiry",
      "pattern": "cookies may have expired|<!doctype|login redirect",
      "type": "auth",
      "severity": "critical",
      "remediation": {
        "automated": false,
        "command": "nlm login",
        "description": "Google cookies expired. Quit Chrome (Cmd+Q), run nlm login, then refresh secrets.",
        "postAction": "Filter cookies to .google.com domain only. YouTube cookies (.youtube.com) have same names (SID, HSID) but different values — including them breaks NotebookLM auth."
      },
      "verified": true,
      "addedBy": "manual",
      "addedAt": "2026-03-17"
    },
    {
      "id": "supabase-timeout",
      "pattern": "522|ETIMEDOUT|EarlyDrop|fetch failed",
      "type": "infrastructure",
      "severity": "high",
      "remediation": {
        "automated": true,
        "strategy": "backoff",
        "delays": [2000, 5000, 15000],
        "description": "Supabase timeout — retry with exponential backoff"
      },
      "verified": true,
      "addedBy": "manual",
      "addedAt": "2026-03-17"
    },
    {
      "id": "nlm-source-precondition",
      "pattern": "FAILED_PRECONDITION",
      "type": "nlm",
      "severity": "medium",
      "remediation": {
        "automated": true,
        "strategy": "skip",
        "description": "Source add failed with precondition error — skip and continue with remaining sources"
      },
      "verified": true,
      "addedBy": "manual",
      "addedAt": "2026-03-17"
    },
    {
      "id": "nlm-rate-limit",
      "pattern": "INVALID_ARGUMENT",
      "type": "nlm",
      "severity": "high",
      "remediation": {
        "automated": true,
        "strategy": "backoff",
        "delays": [30000, 60000],
        "description": "NLM rate limited — wait and retry"
      },
      "verified": true,
      "addedBy": "manual",
      "addedAt": "2026-03-17"
    },
    {
      "id": "supabase-duplicate-key",
      "pattern": "duplicate key|obsidian_chunks_vault_rel_path",
      "type": "infrastructure",
      "severity": "medium",
      "remediation": {
        "automated": false,
        "command": "Delete stale chunks from obsidian_chunks table, then re-index",
        "description": "Race condition from partial previous indexing attempt"
      },
      "verified": true,
      "addedBy": "manual",
      "addedAt": "2026-03-17"
    },
    {
      "id": "env-var-missing",
      "pattern": "NLM_COOKIES.*required|SUPABASE_URL.*undefined|ANTHROPIC_API_KEY.*undefined",
      "type": "config",
      "severity": "critical",
      "remediation": {
        "automated": false,
        "description": "Required environment variable missing. Check .env file or GitHub Actions secrets."
      },
      "verified": true,
      "addedBy": "manual",
      "addedAt": "2026-03-17"
    }
  ]
}
```

- [ ] **Step 3: Verify catalog is valid JSON**

Run: `node -e "JSON.parse(require('fs').readFileSync(require('path').join(require('os').homedir(), '.carl/pipeline-runner/known-issues.json'), 'utf8')); console.log('Valid JSON')"`
Expected: `Valid JSON`

- [ ] **Step 4: Commit**

```bash
cd ~/.carl && git init 2>/dev/null; git add pipeline-runner/known-issues.json && git commit -m "feat: add initial known-issues catalog with 6 verified entries"
```

---

### Task 2: Write pipeline-runner.js — catalog loading and matching

**Files:**
- Create: `~/.carl/pipeline-runner/pipeline-runner.js`
- Test: `~/.carl/pipeline-runner/test/test-catalog.js`

- [ ] **Step 1: Write failing test for catalog loading**

Create `~/.carl/pipeline-runner/test/test-catalog.js`:

```js
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import path from 'node:path';

// We'll test internal functions via a test helper export
const TEST_DIR = path.join(import.meta.dirname, '..', 'test-tmp');
const CATALOG_PATH = path.join(TEST_DIR, 'known-issues.json');

function setup() {
  mkdirSync(TEST_DIR, { recursive: true });
}

function teardown() {
  rmSync(TEST_DIR, { recursive: true, force: true });
}

describe('Catalog Loading', () => {
  before(setup);
  after(teardown);

  it('loads valid catalog and returns verified issues', async () => {
    const { loadCatalog } = await import('../pipeline-runner.js');
    const catalog = {
      version: 1,
      issues: [
        { id: 'test-issue', pattern: 'ETIMEDOUT', severity: 'high', remediation: { automated: true, strategy: 'backoff', delays: [1000] }, verified: true },
        { id: 'unverified-issue', pattern: 'something', severity: 'low', remediation: { automated: true, strategy: 'skip' }, verified: false },
      ]
    };
    writeFileSync(CATALOG_PATH, JSON.stringify(catalog));
    const loaded = loadCatalog(CATALOG_PATH, { verifiedOnly: true });
    assert.equal(loaded.length, 1);
    assert.equal(loaded[0].id, 'test-issue');
  });

  it('returns empty array for missing catalog file', async () => {
    const { loadCatalog } = await import('../pipeline-runner.js');
    const loaded = loadCatalog(path.join(TEST_DIR, 'nonexistent.json'), { verifiedOnly: true });
    assert.equal(loaded.length, 0);
  });

  it('returns empty array for corrupt JSON', async () => {
    const { loadCatalog } = await import('../pipeline-runner.js');
    writeFileSync(CATALOG_PATH, 'not valid json{{{');
    const loaded = loadCatalog(CATALOG_PATH, { verifiedOnly: true });
    assert.equal(loaded.length, 0);
  });

  it('warns but loads entries for version > 1', async () => {
    const { loadCatalog } = await import('../pipeline-runner.js');
    const catalog = {
      version: 2,
      issues: [{ id: 'v2-issue', pattern: 'test', severity: 'low', remediation: { automated: true, strategy: 'skip' }, verified: true }]
    };
    writeFileSync(CATALOG_PATH, JSON.stringify(catalog));
    const loaded = loadCatalog(CATALOG_PATH, { verifiedOnly: true });
    assert.equal(loaded.length, 1); // still loads v1-compatible entries
  });
});

describe('Catalog Matching', () => {
  before(setup);
  after(teardown);

  it('matches error against catalog patterns by severity', async () => {
    const { matchError } = await import('../pipeline-runner.js');
    const issues = [
      { id: 'low-match', pattern: 'timeout', severity: 'low', remediation: { automated: true, strategy: 'skip' }, verified: true },
      { id: 'high-match', pattern: 'ETIMEDOUT', severity: 'high', remediation: { automated: true, strategy: 'backoff', delays: [1000] }, verified: true },
    ];
    const match = matchError(new Error('Connection ETIMEDOUT after timeout'), issues);
    assert.equal(match.id, 'high-match'); // higher severity wins
  });

  it('returns null when no patterns match', async () => {
    const { matchError } = await import('../pipeline-runner.js');
    const issues = [
      { id: 'test', pattern: 'UNIQUE_ERROR_STRING', severity: 'high', remediation: { automated: true, strategy: 'skip' }, verified: true },
    ];
    const match = matchError(new Error('something completely different'), issues);
    assert.equal(match, null);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/.carl/pipeline-runner && node --test test/test-catalog.js`
Expected: FAIL — module not found

- [ ] **Step 3: Write pipeline-runner.js — catalog functions**

Create `~/.carl/pipeline-runner/pipeline-runner.js`:

```js
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, unlinkSync, renameSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// ── Severity ranking for catalog matching ──
const SEVERITY_RANK = { critical: 4, high: 3, medium: 2, low: 1 };

// ── Timeout defaults by step type (ms) ──
const TIMEOUT_DEFAULTS = {
  api: { timeout: 30_000, maxRetries: 2 },
  nlm: { timeout: 60_000, maxRetries: 2 },
  'nlm-longpoll': { timeout: 720_000, maxRetries: 1 },
  file: { timeout: 300_000, maxRetries: 2 },
  auth: { timeout: 120_000, maxRetries: 1 },
  interactive: { timeout: 0, maxRetries: 0 },
};

// ── Catalog Loading ──

export function loadCatalog(catalogPath, { verifiedOnly = true } = {}) {
  try {
    const raw = readFileSync(catalogPath, 'utf8');
    const catalog = JSON.parse(raw);
    if (catalog.version > 1) {
      console.warn(`[pipeline-runner] Catalog version ${catalog.version} > 1, using v1-compatible entries only`);
    }
    let issues = catalog.issues || [];
    if (verifiedOnly) {
      issues = issues.filter(i => i.verified === true);
    }
    return issues;
  } catch (err) {
    if (err.code === 'ENOENT') {
      // Missing file — create default
      try {
        mkdirSync(path.dirname(catalogPath), { recursive: true });
        writeFileSync(catalogPath, JSON.stringify({ version: 1, issues: [] }, null, 2));
      } catch { /* ignore write errors */ }
    } else {
      console.warn(`[pipeline-runner] Failed to load catalog: ${err.message}`);
    }
    return [];
  }
}

// ── Catalog Matching ──

export function matchError(error, issues) {
  const errorText = `${error.message}\n${error.stack || ''}`;
  const matches = [];

  for (const issue of issues) {
    try {
      const regex = new RegExp(issue.pattern, 'i');
      const m = errorText.match(regex);
      if (m) {
        matches.push({ ...issue, _matchLength: m[0].length });
      }
    } catch {
      // Invalid regex in catalog — skip
    }
  }

  if (matches.length === 0) return null;

  // Sort: highest severity first, then longest match
  matches.sort((a, b) => {
    const sevDiff = (SEVERITY_RANK[b.severity] || 0) - (SEVERITY_RANK[a.severity] || 0);
    if (sevDiff !== 0) return sevDiff;
    return (b._matchLength || 0) - (a._matchLength || 0);
  });

  return matches[0];
}

// ── Atomic Write (for catalog updates) ──

export function atomicWriteJSON(filePath, data) {
  const tmpPath = filePath + '.tmp.' + process.pid;
  writeFileSync(tmpPath, JSON.stringify(data, null, 2));
  renameSync(tmpPath, filePath);
}

// ── Runlog Cleanup ──

export function cleanupOldRunlogs(logDir, maxAgeDays = 30) {
  try {
    const cutoff = Date.now() - maxAgeDays * 86_400_000;
    const files = readdirSync(logDir);
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const filePath = path.join(logDir, file);
      const stat = statSync(filePath);
      if (stat.mtimeMs < cutoff) {
        unlinkSync(filePath);
      }
    }
  } catch {
    // Log dir may not exist yet — that's fine
  }
}

// ── Sleep Utility ──

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Placeholder for runPipeline (Task 3) ──

export async function runPipeline(pipelineName, steps, options = {}) {
  throw new Error('Not implemented yet — see Task 3');
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd ~/.carl/pipeline-runner && node --test test/test-catalog.js`
Expected: All 4 tests PASS

- [ ] **Step 5: Commit**

```bash
cd ~/.carl/pipeline-runner && git add pipeline-runner.js test/test-catalog.js && git commit -m "feat: pipeline-runner catalog loading, matching, and utility functions"
```

---

### Task 3: Write pipeline-runner.js — runPipeline core execution

**Files:**
- Modify: `~/.carl/pipeline-runner/pipeline-runner.js` (replace placeholder `runPipeline`)
- Test: `~/.carl/pipeline-runner/test/test-runner.js`

- [ ] **Step 1: Write failing tests for runPipeline**

Create `~/.carl/pipeline-runner/test/test-runner.js`:

```js
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const TEST_DIR = path.join(import.meta.dirname, '..', 'test-tmp');
const LOG_DIR = path.join(TEST_DIR, 'logs');
const CATALOG_PATH = path.join(TEST_DIR, 'known-issues.json');

function setup() {
  mkdirSync(LOG_DIR, { recursive: true });
  writeFileSync(CATALOG_PATH, JSON.stringify({
    version: 1,
    issues: [
      {
        id: 'test-backoff',
        pattern: 'FAKE_TIMEOUT',
        severity: 'high',
        remediation: { automated: true, strategy: 'backoff', delays: [10, 20] },
        verified: true,
      },
      {
        id: 'test-skip',
        pattern: 'SKIP_THIS',
        severity: 'medium',
        remediation: { automated: true, strategy: 'skip' },
        verified: true,
      },
      {
        id: 'test-manual',
        pattern: 'NEEDS_HUMAN',
        severity: 'critical',
        remediation: { automated: false, command: 'do something', description: 'Human needed' },
        verified: true,
      },
    ],
  }));
}

function teardown() {
  rmSync(TEST_DIR, { recursive: true, force: true });
}

describe('runPipeline', () => {
  before(setup);
  after(teardown);

  it('runs all steps successfully and writes runlog', async () => {
    const { runPipeline } = await import('../pipeline-runner.js');
    const result = await runPipeline('test-happy', [
      { name: 'step-a', type: 'api', fn: async (ctx) => { ctx.a = 1; } },
      { name: 'step-b', type: 'api', fn: async (ctx) => { ctx.b = ctx.a + 1; } },
    ], { logDir: LOG_DIR, catalogPath: CATALOG_PATH });

    assert.equal(result.success, true);
    assert.equal(result.stepsCompleted, 2);
    assert.equal(result.totalSteps, 2);
    assert.ok(result.runlogPath);

    const runlog = JSON.parse(readFileSync(result.runlogPath, 'utf8'));
    assert.equal(runlog.pipeline, 'test-happy');
    assert.equal(runlog.success, true);
    assert.equal(runlog.steps.length, 2);
    assert.equal(runlog.steps[0].status, 'success');
    assert.equal(runlog.steps[1].status, 'success');
  });

  it('retries with backoff on known catalog match', async () => {
    const { runPipeline } = await import('../pipeline-runner.js');
    let attempts = 0;
    const result = await runPipeline('test-backoff', [
      { name: 'flaky', type: 'api', fn: async () => {
        attempts++;
        if (attempts < 3) throw new Error('FAKE_TIMEOUT occurred');
      }},
    ], { logDir: LOG_DIR, catalogPath: CATALOG_PATH });

    assert.equal(result.success, true);
    assert.equal(attempts, 3); // original + 2 retries
  });

  it('skips step on catalog skip strategy', async () => {
    const { runPipeline } = await import('../pipeline-runner.js');
    const result = await runPipeline('test-skip', [
      { name: 'skip-me', type: 'api', fn: async () => { throw new Error('SKIP_THIS error'); } },
      { name: 'after-skip', type: 'api', fn: async (ctx) => { ctx.reached = true; } },
    ], { logDir: LOG_DIR, catalogPath: CATALOG_PATH });

    assert.equal(result.success, true);
    const runlog = JSON.parse(readFileSync(result.runlogPath, 'utf8'));
    assert.equal(runlog.steps[0].status, 'skipped');
    assert.equal(runlog.steps[1].status, 'success');
  });

  it('aborts on non-automated catalog match', async () => {
    const { runPipeline } = await import('../pipeline-runner.js');
    const result = await runPipeline('test-manual', [
      { name: 'needs-human', type: 'api', fn: async () => { throw new Error('NEEDS_HUMAN action'); } },
      { name: 'never-reached', type: 'api', fn: async () => {} },
    ], { logDir: LOG_DIR, catalogPath: CATALOG_PATH });

    assert.equal(result.success, false);
    assert.equal(result.stepsCompleted, 0);
    assert.ok(result.error.includes('NEEDS_HUMAN'));
  });

  it('continues on failure when continueOnFail is set', async () => {
    const { runPipeline } = await import('../pipeline-runner.js');
    const result = await runPipeline('test-continue', [
      { name: 'fails-ok', type: 'api', maxRetries: 0, fn: async () => { throw new Error('no big deal'); }, continueOnFail: true },
      { name: 'still-runs', type: 'api', fn: async (ctx) => { ctx.ok = true; } },
    ], { logDir: LOG_DIR, catalogPath: CATALOG_PATH });

    assert.equal(result.success, true);
    const runlog = JSON.parse(readFileSync(result.runlogPath, 'utf8'));
    assert.equal(runlog.steps[0].status, 'partial');
    assert.equal(runlog.steps[1].status, 'success');
  });

  it('aborts on failure when continueOnFail is not set', async () => {
    const { runPipeline } = await import('../pipeline-runner.js');
    const result = await runPipeline('test-abort', [
      { name: 'fails-hard', type: 'api', maxRetries: 0, fn: async () => { throw new Error('fatal'); } },
      { name: 'never-runs', type: 'api', fn: async () => {} },
    ], { logDir: LOG_DIR, catalogPath: CATALOG_PATH });

    assert.equal(result.success, false);
    assert.equal(result.stepsCompleted, 0);
  });

  it('rejects interactive type without explicit timeout', async () => {
    const { runPipeline } = await import('../pipeline-runner.js');
    await assert.rejects(
      () => runPipeline('test-interactive', [
        { name: 'bad-interactive', type: 'interactive', fn: async () => {} },
      ], { logDir: LOG_DIR, catalogPath: CATALOG_PATH }),
      /interactive.*timeout/i,
    );
  });

  it('calls onStepComplete and onStepFail callbacks', async () => {
    const { runPipeline } = await import('../pipeline-runner.js');
    const completedSteps = [];
    const failedSteps = [];

    await runPipeline('test-callbacks', [
      { name: 'ok-step', type: 'api', fn: async () => {} },
      { name: 'bad-step', type: 'api', maxRetries: 0, fn: async () => { throw new Error('oops'); }, continueOnFail: true },
    ], {
      logDir: LOG_DIR,
      catalogPath: CATALOG_PATH,
      onStepComplete: (step) => completedSteps.push(step.name),
      onStepFail: (step) => failedSteps.push(step.name),
    });

    assert.deepEqual(completedSteps, ['ok-step']);
    assert.deepEqual(failedSteps, ['bad-step']);
  });

  it('cleans up runlogs older than 30 days', async () => {
    const { cleanupOldRunlogs } = await import('../pipeline-runner.js');
    // Create an old runlog
    const oldFile = path.join(LOG_DIR, 'old-test-2026-01-01.json');
    writeFileSync(oldFile, '{}');
    // Backdate its mtime to 60 days ago
    const { utimesSync } = await import('node:fs');
    const sixtyDaysAgo = new Date(Date.now() - 60 * 86_400_000);
    utimesSync(oldFile, sixtyDaysAgo, sixtyDaysAgo);
    // Create a recent runlog
    const newFile = path.join(LOG_DIR, 'new-test-2026-03-17.json');
    writeFileSync(newFile, '{}');

    cleanupOldRunlogs(LOG_DIR, 30);

    assert.equal(existsSync(oldFile), false);
    assert.equal(existsSync(newFile), true);
  });

  it('reuses last delay when retries exceed delays array length', async () => {
    const { runPipeline } = await import('../pipeline-runner.js');
    // Create catalog with 1 delay but allow 3 retries
    writeFileSync(CATALOG_PATH, JSON.stringify({
      version: 1,
      issues: [{
        id: 'short-delays',
        pattern: 'OVERFLOW_TEST',
        severity: 'high',
        remediation: { automated: true, strategy: 'backoff', delays: [10] },
        verified: true,
      }],
    }));
    let attempts = 0;
    const result = await runPipeline('test-overflow', [
      { name: 'overflow', type: 'api', maxRetries: 3, fn: async () => {
        attempts++;
        if (attempts < 4) throw new Error('OVERFLOW_TEST');
      }},
    ], { logDir: LOG_DIR, catalogPath: CATALOG_PATH });
    assert.equal(result.success, true);
    assert.equal(attempts, 4); // original + 3 retries, last delay reused
  });

  it('times out a slow step', async () => {
    const { runPipeline } = await import('../pipeline-runner.js');
    const result = await runPipeline('test-timeout', [
      { name: 'slow', type: 'api', timeout: 50, maxRetries: 0, fn: async () => {
        await new Promise(r => setTimeout(r, 5000));
      }, continueOnFail: true },
    ], { logDir: LOG_DIR, catalogPath: CATALOG_PATH });

    const runlog = JSON.parse(readFileSync(result.runlogPath, 'utf8'));
    assert.equal(runlog.steps[0].status, 'partial');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd ~/.carl/pipeline-runner && node --test test/test-runner.js`
Expected: FAIL — runPipeline throws "Not implemented yet"

- [ ] **Step 3: Implement runPipeline in pipeline-runner.js**

Replace the placeholder `runPipeline` export in `~/.carl/pipeline-runner/pipeline-runner.js` with:

```js
export async function runPipeline(pipelineName, steps, options = {}) {
  const logDir = options.logDir || path.join(os.homedir(), '.carl/pipeline-runner/logs');
  const catalogPath = options.catalogPath || path.join(os.homedir(), '.carl/pipeline-runner/known-issues.json');
  const { onStepComplete, onStepFail } = options;

  // Validate: reject interactive steps without explicit timeout
  for (const step of steps) {
    if (step.type === 'interactive' && !step.timeout) {
      throw new Error(`Step "${step.name}" has type 'interactive' but no explicit timeout — not allowed in Node module`);
    }
  }

  // Ensure log directory exists
  mkdirSync(logDir, { recursive: true });

  // Cleanup old runlogs
  cleanupOldRunlogs(logDir, 30);

  // Load catalog (verified only for automated runs)
  const issues = loadCatalog(catalogPath, { verifiedOnly: true });

  // Shared context for inter-step data flow
  const ctx = {};

  // Runlog state
  const runlog = {
    pipeline: pipelineName,
    startedAt: new Date().toISOString(),
    completedAt: null,
    success: false,
    steps: [],
  };

  // SIGTERM/SIGINT handler — write partial runlog
  let killed = false;
  const signalHandler = (signal) => {
    killed = true;
    runlog.completedAt = new Date().toISOString();
    runlog.success = false;
    runlog.killedBy = signal;
    const runlogPath = writeRunlog(logDir, pipelineName, runlog);
    console.error(`[pipeline-runner] Killed by ${signal}. Partial runlog: ${runlogPath}`);
    process.exit(1);
  };
  process.on('SIGTERM', signalHandler);
  process.on('SIGINT', signalHandler);

  let stepsCompleted = 0;

  try {
    for (const step of steps) {
      if (killed) break;

      const defaults = TIMEOUT_DEFAULTS[step.type] || TIMEOUT_DEFAULTS.api;
      const timeout = step.timeout ?? defaults.timeout;
      const maxRetries = step.maxRetries ?? defaults.maxRetries;

      const stepLog = {
        name: step.name,
        type: step.type,
        status: null,
        duration: 0,
        attempts: 0,
        warnings: [],
        catalogMatch: null,
      };

      let succeeded = false;
      let lastError = null;
      let attempt = 0;
      let catalogMatch = null;

      while (attempt <= maxRetries && !succeeded && !killed) {
        attempt++;
        stepLog.attempts = attempt;
        const start = Date.now();

        try {
          if (timeout > 0) {
            await Promise.race([
              step.fn(ctx),
              new Promise((_, reject) => setTimeout(() => reject(new Error(`Step "${step.name}" timed out after ${timeout}ms`)), timeout)),
            ]);
          } else {
            await step.fn(ctx);
          }
          stepLog.duration = Date.now() - start;
          stepLog.status = 'success';
          succeeded = true;
        } catch (err) {
          stepLog.duration = Date.now() - start;
          lastError = err;

          // First failure: match against catalog
          if (attempt === 1) {
            catalogMatch = matchError(err, issues);
          }

          if (catalogMatch) {
            stepLog.catalogMatch = catalogMatch.id;

            if (catalogMatch.remediation.automated) {
              if (catalogMatch.remediation.strategy === 'skip') {
                stepLog.status = 'skipped';
                stepLog.warnings.push(`${err.message} — skipped per catalog (${catalogMatch.id})`);
                succeeded = true; // skip counts as "ok, move on"
                break;
              }

              if (catalogMatch.remediation.strategy === 'backoff' && attempt <= maxRetries) {
                const delays = catalogMatch.remediation.delays || [2000];
                const delay = delays[Math.min(attempt - 1, delays.length - 1)];
                stepLog.warnings.push(`Attempt ${attempt} failed: ${err.message} — retrying in ${delay}ms (${catalogMatch.id})`);
                await sleep(delay);
                continue;
              }
            } else {
              // Non-automated: abort immediately
              stepLog.status = 'failed';
              stepLog.warnings.push(`${catalogMatch.description || catalogMatch.remediation.description} (${catalogMatch.id})`);
              if (catalogMatch.remediation.command) {
                stepLog.warnings.push(`Run: ${catalogMatch.remediation.command}`);
              }
              break;
            }
          }

          // No catalog match or catalog retries exhausted: simple backoff retry
          if (attempt <= maxRetries) {
            stepLog.warnings.push(`Attempt ${attempt} failed: ${err.message} — retrying in 2s`);
            await sleep(2000);
            continue;
          }
        }
      }

      // Determine final status if not set
      if (!stepLog.status) {
        if (succeeded) {
          stepLog.status = 'success';
        } else if (step.continueOnFail) {
          stepLog.status = 'partial';
          stepLog.warnings.push(`All ${attempt} attempts failed: ${lastError?.message}`);
        } else {
          stepLog.status = 'failed';
          stepLog.warnings.push(`All ${attempt} attempts failed: ${lastError?.message}`);
        }
      }

      // Clean up empty arrays
      if (stepLog.warnings.length === 0) delete stepLog.warnings;
      if (!stepLog.catalogMatch) delete stepLog.catalogMatch;

      runlog.steps.push(stepLog);

      if (stepLog.status === 'success' || stepLog.status === 'skipped' || stepLog.status === 'partial') {
        stepsCompleted++;
        if (onStepComplete && (stepLog.status === 'success')) {
          try { await onStepComplete(step, null, stepLog.duration); } catch {}
        }
        if (onStepFail && (stepLog.status === 'partial' || stepLog.status === 'skipped')) {
          try { await onStepFail(step, lastError, catalogMatch); } catch {}
        }
      } else {
        // Failed — abort pipeline
        if (onStepFail) {
          try { await onStepFail(step, lastError, catalogMatch); } catch {}
        }
        break;
      }
    }

    runlog.success = runlog.steps.every(s => s.status !== 'failed');
    runlog.completedAt = new Date().toISOString();
    const runlogPath = writeRunlog(logDir, pipelineName, runlog);

    return {
      success: runlog.success,
      stepsCompleted,
      totalSteps: steps.length,
      runlogPath,
      error: runlog.success ? null : runlog.steps.find(s => s.status === 'failed')?.warnings?.slice(-1)[0] || null,
    };
  } finally {
    process.removeListener('SIGTERM', signalHandler);
    process.removeListener('SIGINT', signalHandler);
  }
}

function writeRunlog(logDir, pipelineName, runlog) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `${pipelineName}-${timestamp}.json`;
  const runlogPath = path.join(logDir, filename);
  mkdirSync(logDir, { recursive: true });
  atomicWriteJSON(runlogPath, runlog);
  return runlogPath;
}

// ── Catalog Entry Addition (used by Claude skill) ──

export function addCatalogEntry(catalogPath, entry) {
  const defaultPath = catalogPath || path.join(os.homedir(), '.carl/pipeline-runner/known-issues.json');
  let catalog;
  try {
    catalog = JSON.parse(readFileSync(defaultPath, 'utf8'));
  } catch {
    catalog = { version: 1, issues: [] };
  }
  catalog.issues.push({
    ...entry,
    verified: false,
    addedBy: 'claude',
    addedAt: new Date().toISOString().split('T')[0],
  });
  atomicWriteJSON(defaultPath, catalog);
}
```

- [ ] **Step 4: Run all tests**

Run: `cd ~/.carl/pipeline-runner && node --test test/test-catalog.js test/test-runner.js`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
cd ~/.carl/pipeline-runner && git add pipeline-runner.js test/test-runner.js && git commit -m "feat: implement runPipeline with timeout, retry, catalog matching, and runlog"
```

---

## Chunk 2: Claude Code Skill, CARL Domain, and Integration

### Task 4: Create the Claude Code skill

**Files:**
- Create: `~/.claude/skills/pipeline-runner/SKILL.md`

- [ ] **Step 1: Write SKILL.md**

Create `~/.claude/skills/pipeline-runner/SKILL.md`:

```markdown
---
name: pipeline-runner
description: Resilient pipeline runner — behavioral guardrails for multi-step workflows. Enforces retry discipline, known-issues catalog checking, and structured logging. Activates for article-fodder, podcast generation, vault indexing, and any multi-step pipeline work.
---

# Pipeline Runner Skill

When executing any multi-step workflow (article-fodder, podcast pipeline, vault indexing, etc.), follow these rules:

## Before Starting

1. Read the known-issues catalog: `~/.carl/pipeline-runner/known-issues.json`
2. Note how many verified and unverified entries exist

## During Execution

3. **Announce each step** before running it: "Step N: [name] (type: [type])"
4. **On any failure**, BEFORE attempting to debug:
   - Match the error message against patterns in `known-issues.json`
   - If a match is found: follow the remediation instructions exactly
   - If no match: debug normally
5. **Retry cap**: Max 2 auto-remediation attempts per step. If it fails twice with the same approach, the approach is wrong. Stop and ask the user.
6. **Never brute-force**: Do not retry the exact same action more than twice.

## After Resolving a Novel Failure

7. Ask the user: "Should I add this to the known-issues catalog?"
8. If yes, append an entry to `~/.carl/pipeline-runner/known-issues.json` with:
   - `verified: false`
   - `addedBy: "claude"`
   - `addedAt: "<today's ISO date>"`
   - A specific regex pattern matching the error
   - Appropriate remediation strategy
9. Tell the user: "Added as unverified — it won't run in automated pipelines until you set verified: true."

## After Workflow Completes

10. Write a runlog JSON to `~/.carl/pipeline-runner/logs/` with this format:

```json
{
  "pipeline": "<workflow-name>",
  "startedAt": "<ISO>",
  "completedAt": "<ISO>",
  "success": true|false,
  "interactive": true,
  "steps": [
    { "name": "step-name", "type": "type", "status": "success|failed|skipped|partial", "duration": 1234, "attempts": 1 }
  ]
}
```

## What This Skill Does NOT Do

- Does not apply to single-step tasks or simple questions
- Does not override explicit user instructions
- Does not wrap Node.js pipeline execution (use the `pipeline-runner.js` module for that)
```

- [ ] **Step 2: Verify skill file exists and is readable**

Run: `cat ~/.claude/skills/pipeline-runner/SKILL.md | head -5`
Expected: Shows the frontmatter

- [ ] **Step 3: Commit**

```bash
cd ~/.claude && git add skills/pipeline-runner/SKILL.md && git commit -m "feat: add pipeline-runner Claude Code skill"
```

---

### Task 5: Create the CARL domain

**Files:**
- Create: `~/.carl/pipeline/rules`
- Modify: `~/.carl/manifest`

- [ ] **Step 1: Read current manifest**

Run: `cat ~/.carl/manifest`

- [ ] **Step 2: Create pipeline domain rules file**

Create `~/.carl/pipeline/rules`:

```
0. Pipeline domain applies when running multi-step automated or interactive workflows (article-fodder, podcast generation, vault indexing, etc.).
1. Before debugging any pipeline failure, check ~/.carl/pipeline-runner/known-issues.json for a matching pattern. Follow the remediation if found.
2. Max 2 retry attempts per step. If it fails twice, stop and ask the user — do not brute-force.
3. After resolving a novel failure, ask the user if it should be added to the known-issues catalog (as unverified).
4. At workflow completion, write a runlog JSON to ~/.carl/pipeline-runner/logs/ capturing each step's status, duration, and any warnings.
5. For automated pipelines (cron, GitHub Actions), use the pipeline-runner.js Node module. For interactive workflows, follow the pipeline-runner Claude Code skill.
```

- [ ] **Step 3: Add PIPELINE domain to manifest**

Append to `~/.carl/manifest`:

```

# ============================================================================
# PIPELINE - Resilient pipeline runner for multi-step workflows
# ============================================================================
PIPELINE_STATE=active
PIPELINE_ALWAYS_ON=false
PIPELINE_RECALL=pipeline,run pipeline,article-fodder,generate podcast,index vault,vault indexing
```

- [ ] **Step 4: Verify manifest loads correctly**

Run: `grep PIPELINE ~/.carl/manifest`
Expected: Shows PIPELINE_STATE=active, PIPELINE_ALWAYS_ON=false, PIPELINE_RECALL=...

- [ ] **Step 5: Commit**

```bash
cd ~/.carl && git add pipeline/rules manifest && git commit -m "feat: add PIPELINE CARL domain with keyword triggers"
```

---

### Task 6: Integrate with News Podcast generate.js

**Files:**
- Modify: `/Users/carlgerber/Dropbox/425 Websites/Custom News Podcaster/scripts/generate.js`

- [ ] **Step 1: Read current generate.js**

Read: `/Users/carlgerber/Dropbox/425 Websites/Custom News Podcaster/scripts/generate.js`

- [ ] **Step 2: Refactor generate.js to use runPipeline**

Replace the body of `main()` (lines 20-109) with pipeline-runner integration. The key changes:
- Import `runPipeline` from `~/.carl/pipeline-runner/pipeline-runner.js` using `os.homedir()`
- Define each logical step as a step object with `ctx` for data flow
- Move the outer try/catch error handling to `onStepFail`
- Preserve the `cleanupOldPodcasts` call as a final step with `continueOnFail: true`

```js
import { createClient } from '@supabase/supabase-js';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fetchArticlesForTopic } from './rss-feeds.js';
import { cleanCustomQuery, searchGoogleNews } from './custom-query.js';
import { refreshAuth, createNotebook, addSource, generateAudio, downloadAudio, deleteNotebook, getSourceIds } from './notebooklm.js';

import { pathToFileURL } from 'node:url';
const { runPipeline } = await import(pathToFileURL(path.join(os.homedir(), '.carl/pipeline-runner/pipeline-runner.js')).href);

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const DEFAULT_TOPICS = ['ai'];
const DEFAULT_ARTICLE_COUNT = 8;

async function updatePodcast(podcastId, updates) {
  const { error } = await supabase.from('podcasts').update(updates).eq('id', podcastId);
  if (error) console.error('Failed to update podcast:', error);
}

async function main() {
  const podcastId = process.env.INPUT_PODCAST_ID || null;
  const topics = process.env.INPUT_TOPICS ? JSON.parse(process.env.INPUT_TOPICS) : DEFAULT_TOPICS;
  const customQuery = process.env.INPUT_CUSTOM_QUERY || null;
  const articleCount = parseInt(process.env.INPUT_ARTICLE_COUNT || String(DEFAULT_ARTICLE_COUNT), 10);

  // Create podcast row if needed (wrapped in try/catch for error handling)
  let id = podcastId;
  try {
    if (!id) {
      const { data, error } = await supabase
        .from('podcasts')
        .insert({ topics, status: 'generating', article_count: articleCount })
        .select('id')
        .single();
      if (error) throw error;
      id = data.id;
    }
  } catch (err) {
    console.error('Failed to create podcast row:', err);
    process.exit(1);
  }

  console.log(`Pipeline started for podcast ${id}, topics: ${topics.join(', ')}`);

  const steps = [
    {
      name: 'refresh-auth',
      type: 'auth',
      fn: async () => { await refreshAuth(); },
    },
    {
      name: 'fetch-articles',
      type: 'api',
      fn: async (ctx) => {
        let allArticles = [];
        for (const topic of topics) {
          if (topic === 'custom' && customQuery) {
            const cleaned = await cleanCustomQuery(customQuery);
            const customArticles = await searchGoogleNews(cleaned, articleCount);
            allArticles.push(...customArticles);
          } else if (topic !== 'custom') {
            const topicArticles = await fetchArticlesForTopic(topic, articleCount);
            allArticles.push(...topicArticles);
          }
        }
        const seen = new Set();
        allArticles = allArticles.filter(a => { if (seen.has(a.url)) return false; seen.add(a.url); return true; });
        if (allArticles.length === 0) throw new Error('No articles found for the selected topics');
        console.log(`Collected ${allArticles.length} unique articles`);
        await updatePodcast(id, { articles: allArticles, article_count: allArticles.length });
        ctx.articles = allArticles;
      },
    },
    {
      name: 'create-notebook',
      type: 'nlm',
      fn: async (ctx) => {
        const today = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        const notebookTitle = `News Podcast — ${today}`;
        ctx.notebookId = await createNotebook(notebookTitle);
        await updatePodcast(id, { notebook_id: ctx.notebookId });
      },
    },
    {
      name: 'add-sources',
      type: 'nlm',
      timeout: 300_000, // 5 min — iterates articles with 3s delays, needs more than 60s default
      continueOnFail: true,
      fn: async (ctx) => {
        const sourceIds = [];
        for (const article of ctx.articles) {
          try {
            const sourceId = await addSource(ctx.notebookId, article.url);
            if (sourceId) sourceIds.push(sourceId);
            await new Promise(r => setTimeout(r, 3000));
          } catch (err) { console.warn(`Failed to add source ${article.url}:`, err.message); }
        }
        if (sourceIds.length === 0) throw new Error('No source IDs collected — cannot generate audio');
        ctx.sourceIds = sourceIds;
        console.log(`Collected ${sourceIds.length} source IDs of ${ctx.articles.length} articles`);
      },
    },
    {
      name: 'generate-audio',
      type: 'nlm-longpoll',
      fn: async (ctx) => {
        console.log('Waiting 15s for sources to index...');
        await new Promise(r => setTimeout(r, 15000));
        const { audioUrl } = await generateAudio(ctx.notebookId, ctx.sourceIds);
        await updatePodcast(id, { audio_url: audioUrl, status: 'audio_ready' });
        console.log(`Podcast ${id} audio ready for download: ${audioUrl.slice(0, 80)}...`);
      },
    },
    {
      name: 'cleanup-old',
      type: 'api',
      continueOnFail: true,
      fn: async () => { await cleanupOldPodcasts(); },
    },
  ];

  const result = await runPipeline('news-podcast', steps, {
    onStepFail: async (step, error) => {
      await updatePodcast(id, { status: 'failed', error_message: `${step.name}: ${error?.message}` });
    },
  });

  if (!result.success) {
    console.error(`Pipeline failed. Runlog: ${result.runlogPath}`);
    process.exit(1);
  }

  console.log(`Pipeline complete. Runlog: ${result.runlogPath}`);
}

async function cleanupOldPodcasts() {
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const { data: oldPodcasts, error } = await supabase
    .from('podcasts')
    .select('id, notebook_id, audio_url')
    .lt('created_at', sevenDaysAgo.toISOString());
  if (error || !oldPodcasts || oldPodcasts.length === 0) return;
  console.log(`Cleaning up ${oldPodcasts.length} old podcasts...`);
  for (const podcast of oldPodcasts) {
    try { await supabase.storage.from('podcast-audio').remove([`${podcast.id}.m4a`]); }
    catch (err) { console.warn(`Failed to delete audio for ${podcast.id}:`, err.message); }
    if (podcast.notebook_id) await deleteNotebook(podcast.notebook_id);
    await supabase.from('podcasts').delete().eq('id', podcast.id);
  }
}

main();
```

- [ ] **Step 3: Verify generate.js has no syntax errors**

Run: `cd "/Users/carlgerber/Dropbox/425 Websites/Custom News Podcaster" && node --check scripts/generate.js`
Expected: No output (clean parse)

- [ ] **Step 4: Commit**

```bash
cd "/Users/carlgerber/Dropbox/425 Websites/Custom News Podcaster" && git add scripts/generate.js && git commit -m "refactor: wrap generate.js pipeline with pipeline-runner for resilient execution"
```

---

### Task 7: Integrate with Phase 2 download-audio.js

**Files:**
- Modify: `/Users/carlgerber/Dropbox/425 Websites/Custom News Podcaster/scripts/download-audio.js`

- [ ] **Step 1: Read current download-audio.js**

Read: `/Users/carlgerber/Dropbox/425 Websites/Custom News Podcaster/scripts/download-audio.js`

- [ ] **Step 2: Refactor download-audio.js to use runPipeline for in-process steps**

Preserve the cross-invocation retry logic (retry_count in Supabase). Wrap the download+validate+upload steps within each podcast iteration:

```js
/**
 * Phase 2: Local audio download cron.
 * Uses pipeline-runner for in-process resilience (timeout, catalog matching, runlog).
 * Cross-invocation retries preserved via retry_count in Supabase.
 */

import { createClient } from '@supabase/supabase-js';
import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import os from 'node:os';

const exec = promisify(execFile);

import { pathToFileURL } from 'node:url';
const { runPipeline } = await import(pathToFileURL(path.join(os.homedir(), '.carl/pipeline-runner/pipeline-runner.js')).href);

const SUPABASE_URL = 'https://yifhgbpzdaphdkxpnydy.supabase.co';
const SUPABASE_SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlpZmhnYnB6ZGFwaGRreHBueWR5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MjU3MDY1MSwiZXhwIjoyMDg4MTQ2NjUxfQ.9hcMgdfqQlK8SJ3j_qF2aoRT89s3r1ut8M33TR48RQ4';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function main() {
  const { data: pending, error } = await supabase
    .from('podcasts')
    .select('id, notebook_id, retry_count')
    .eq('status', 'audio_ready');

  if (error) {
    console.error('Failed to query podcasts:', error);
    process.exit(1);
  }

  if (!pending || pending.length === 0) {
    console.log('No podcasts waiting for download.');
    return;
  }

  console.log(`Found ${pending.length} podcast(s) to download.`);

  for (const podcast of pending) {
    const outputPath = `/tmp/podcast-${podcast.id}.m4a`;

    const steps = [
      {
        name: 'download-audio',
        type: 'file',
        fn: async (ctx) => {
          const nlmPath = process.env.NLM_PATH || `${process.env.HOME}/.local/bin/nlm`;
          await exec(nlmPath, [
            'download', 'audio',
            podcast.notebook_id,
            '-o', outputPath,
            '--no-progress',
          ], { timeout: 120000 });
          ctx.audioBuffer = await readFile(outputPath);
          console.log(`Downloaded: ${ctx.audioBuffer.length} bytes`);
        },
      },
      {
        name: 'validate-audio',
        type: 'api',
        fn: async (ctx) => {
          if (ctx.audioBuffer.slice(0, 15).toString().includes('<!doctype')) {
            throw new Error('Downloaded HTML instead of audio — nlm auth may have expired');
          }
        },
      },
      {
        name: 'upload-to-supabase',
        type: 'api',
        fn: async (ctx) => {
          const storagePath = `${podcast.id}.m4a`;
          const { error: uploadErr } = await supabase.storage
            .from('podcast-audio')
            .upload(storagePath, ctx.audioBuffer, { contentType: 'audio/mp4', upsert: true });
          if (uploadErr) throw new Error(`Upload failed: ${uploadErr.message}`);

          const { data: urlData } = supabase.storage
            .from('podcast-audio')
            .getPublicUrl(storagePath);

          ctx.publicUrl = urlData.publicUrl;
        },
      },
      {
        name: 'mark-ready',
        type: 'api',
        fn: async (ctx) => {
          await supabase.from('podcasts').update({
            audio_url: ctx.publicUrl,
            status: 'ready',
          }).eq('id', podcast.id);
          console.log(`Podcast ${podcast.id} is ready: ${ctx.publicUrl}`);
        },
      },
    ];

    const result = await runPipeline(`download-${podcast.id}`, steps);

    if (!result.success) {
      // Cross-invocation retry logic (preserved from original)
      const retries = (podcast.retry_count || 0) + 1;
      const maxRetries = 6;
      console.error(`Failed to download podcast ${podcast.id} (attempt ${retries}/${maxRetries}). Runlog: ${result.runlogPath}`);

      if (retries >= maxRetries) {
        await supabase.from('podcasts').update({
          status: 'failed',
          error_message: `Audio download failed after ${retries} attempts: ${result.error}`,
          retry_count: retries,
        }).eq('id', podcast.id);
      } else {
        await supabase.from('podcasts').update({
          retry_count: retries,
          error_message: `Retry ${retries}/${maxRetries}: ${result.error}`,
        }).eq('id', podcast.id);
        console.log(`Will retry on next cycle (${retries}/${maxRetries}).`);
      }
    }
  }
}

main();
```

- [ ] **Step 3: Verify download-audio.js has no syntax errors**

Run: `cd "/Users/carlgerber/Dropbox/425 Websites/Custom News Podcaster" && node --check scripts/download-audio.js`
Expected: No output (clean parse)

- [ ] **Step 4: Commit**

```bash
cd "/Users/carlgerber/Dropbox/425 Websites/Custom News Podcaster" && git add scripts/download-audio.js && git commit -m "refactor: wrap download-audio.js with pipeline-runner, preserve cross-invocation retries"
```

---

### Task 8: End-to-end smoke test

- [ ] **Step 1: Run unit tests**

Run: `cd ~/.carl/pipeline-runner && node --test test/test-catalog.js test/test-runner.js`
Expected: All tests PASS

- [ ] **Step 2: Verify generate.js parses cleanly**

Run: `cd "/Users/carlgerber/Dropbox/425 Websites/Custom News Podcaster" && node --check scripts/generate.js`
Expected: No output

- [ ] **Step 3: Verify download-audio.js parses cleanly**

Run: `cd "/Users/carlgerber/Dropbox/425 Websites/Custom News Podcaster" && node --check scripts/download-audio.js`
Expected: No output

- [ ] **Step 4: Verify known-issues.json is valid**

Run: `node -e "const c = JSON.parse(require('fs').readFileSync(require('path').join(require('os').homedir(), '.carl/pipeline-runner/known-issues.json'), 'utf8')); console.log(c.issues.length + ' issues loaded')"`
Expected: `6 issues loaded`

- [ ] **Step 5: Verify CARL manifest has PIPELINE domain**

Run: `grep -A3 PIPELINE_STATE ~/.carl/manifest`
Expected: Shows active state and recall keywords

- [ ] **Step 6: Verify skill file exists**

Run: `head -3 ~/.claude/skills/pipeline-runner/SKILL.md`
Expected: Shows frontmatter

- [ ] **Step 7: Dry-run the runner with a test pipeline**

Run:
```bash
cd ~/.carl/pipeline-runner && node -e "
import('./pipeline-runner.js').then(async ({ runPipeline }) => {
  const result = await runPipeline('smoke-test', [
    { name: 'pass', type: 'api', fn: async (ctx) => { ctx.x = 42; } },
    { name: 'read-ctx', type: 'api', fn: async (ctx) => { if (ctx.x !== 42) throw new Error('ctx broken'); } },
  ]);
  console.log('Success:', result.success, 'Steps:', result.stepsCompleted);
  console.log('Runlog:', result.runlogPath);
});
"
```
Expected: `Success: true Steps: 2` and a runlog path

- [ ] **Step 8: Final commit with all test artifacts cleaned**

```bash
cd ~/.carl/pipeline-runner && rm -rf test-tmp && git add pipeline-runner.js known-issues.json test/ && git commit -m "feat: pipeline-runner v1 complete — module, catalog, tests"
```
