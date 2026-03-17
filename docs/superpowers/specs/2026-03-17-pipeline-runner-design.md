# Pipeline Runner — Design Spec

**Date**: 2026-03-17
**Status**: Approved

## Problem

Multi-step pipelines (news podcast, article-fodder, vault indexing) fail unpredictably from cookie expiry, Supabase timeouts, NLM rate limits, and environment misconfigurations. Current error handling is inconsistent — download-audio.js has retry logic, generate.js has all-or-nothing try/catch, article-fodder has no automated error handling. Debugging the same failure patterns across sessions wastes hours.

## Solution

A cross-project resilient pipeline runner with two components sharing a known-issues catalog:

1. **Node.js module** (`pipeline-runner.js`) — for automated/unattended pipelines
2. **Claude Code skill** (`SKILL.md`) — for interactive/Claude-driven pipelines
3. **Known-issues catalog** (`known-issues.json`) — shared, auto-growing failure pattern database

## Architecture

### File Layout

```
~/.carl/pipeline-runner/
├── pipeline-runner.js          # Node.js module
├── known-issues.json           # Shared failure catalog
└── logs/                       # JSON runlogs per execution
    └── {pipeline}-{timestamp}.json

~/.claude/skills/pipeline-runner/
└── SKILL.md                    # Claude Code behavioral skill

~/.carl/pipeline/
└── rules                       # CARL domain (keyword-triggered)
```

### Component Responsibilities

| Component | Runs When | Error Handling | Catalog Access |
|-----------|-----------|----------------|----------------|
| `pipeline-runner.js` | Automated (cron, GitHub Actions) | Timeout + retry + catalog match | Read only verified entries |
| `SKILL.md` | Interactive (Claude sessions) | Behavioral guardrails for Claude | Read all entries; write new unverified entries |
| `known-issues.json` | Referenced by both | N/A | Grows via Claude, verified by user |

## Node.js Module: `pipeline-runner.js`

### API

```js
const path = require('path');
const os = require('os');
const { runPipeline } = require(path.join(os.homedir(), '.carl/pipeline-runner/pipeline-runner.js'));

const result = await runPipeline(pipelineName, steps, options);
```

> **Path resolution**: Always use `path.join(os.homedir(), '.carl/pipeline-runner/...')` rather than hardcoded absolute paths. This ensures the module works on both local Mac (`/Users/carlgerber`) and GitHub Actions (`/home/runner`).

**Parameters:**

- `pipelineName` (string) — identifier for logging (e.g., `'news-podcast'`)
- `steps` (array) — ordered step definitions
- `options` (object) — optional overrides

**Step Definition:**

```js
{
  name: 'add-sources',        // Human-readable step name
  type: 'nlm',                // Maps to timeout defaults
  fn: async (ctx) => { ... },  // The actual work — receives context object, returns any value
  timeout: 90000,             // Override default timeout in ms (optional)
  maxRetries: 3,              // Override default max retries (optional)
  continueOnFail: true,       // Don't abort pipeline on failure (optional)
}
```

**Options:**

```js
{
  logDir: '/Users/carlgerber/.carl/pipeline-runner/logs',           // Default
  catalogPath: '/Users/carlgerber/.carl/pipeline-runner/known-issues.json', // Default
  onStepComplete: (step, result, duration) => {},  // Optional callback
  onStepFail: (step, error, remediation) => {},    // Optional callback
}
```

**Return Value:**

```js
{
  success: boolean,
  stepsCompleted: number,
  totalSteps: number,
  runlogPath: string,          // Absolute path to the JSON runlog
  error: string | null,        // Error message if failed
}
```

### Timeout Defaults by Step Type

| Step Type | Timeout | Max Retries |
|-----------|---------|-------------|
| `api` | 30s | 2 |
| `nlm` | 60s | 2 |
| `nlm-longpoll` | 12 min | 1 |
| `file` | 5 min | 2 |
| `auth` | 2 min | 1 |
| `interactive` | none | 0 |

> **Note**: `interactive` type is only valid in the Claude skill context. The Node module rejects steps with `type: 'interactive'` and no explicit `timeout` override — prevents hanging in unattended pipelines.

### Inter-Step Data Flow

Steps receive a shared `ctx` (context) object for passing data between steps:

```js
const steps = [
  { name: 'create-notebook', type: 'nlm', fn: async (ctx) => {
    ctx.notebookId = await nlm.createNotebook(title);
  }},
  { name: 'add-sources', type: 'nlm', fn: async (ctx) => {
    ctx.sourceIds = await addAllSources(ctx.notebookId, articles);
  }, continueOnFail: true },
  { name: 'generate-audio', type: 'nlm-longpoll', fn: async (ctx) => {
    ctx.audioUrl = await nlm.generateAudio(ctx.notebookId, ctx.sourceIds);
  }},
];

// Runner creates ctx = {} and passes it to each step.fn(ctx)
```

### Execution Flow

```
for each step in pipeline:
  1. Start timer
  2. Execute step.fn() with AbortSignal timeout
  3. On success:
     - Log step result (name, status: 'success', duration, attempts: 1)
     - Call onStepComplete callback if provided
     - Continue to next step
  4. On failure:
     a. Match error.message + error.stack against known-issues.json patterns (regex)
     b. All matching issues collected; highest severity wins (critical > high > medium > low). On tie, longest pattern match wins.
     c. If match found AND remediation.automated === true AND issue.verified === true:
        - Execute remediation strategy:
          - 'backoff': retry step after delays from remediation.delays array
          - 'skip': log warning, mark step as 'skipped', continue pipeline (distinct from 'partial')
        - Up to maxRetries attempts total (including original)
     d. If match found AND remediation.automated === false:
        - Log the remediation description and command
        - Abort pipeline (human action required)
     e. If no match found:
        - Retry step up to maxRetries with simple 2s backoff
     f. If all retries exhausted:
        - Check step.continueOnFail
          - true: log warning, mark step as 'partial', continue
          - false: abort pipeline
     g. Call onStepFail callback if provided
  5. After all steps (or abort): write runlog JSON to logDir
  6. On SIGTERM/SIGINT: write partial runlog with status 'killed', then exit
```

### Catalog File Resilience

- **Missing file**: Create default `{"version":1,"issues":[]}` and continue
- **Invalid JSON**: Log warning to runlog, fall back to empty catalog (no auto-remediation for this run)
- **Writes**: Use atomic write (write to temp file, then `fs.renameSync`) to prevent corruption from concurrent reads
- **Version mismatch**: If `version` > 1, log warning and use only entries that match v1 schema

### Runlog Cleanup

Runlogs older than 30 days are automatically deleted at the start of each `runPipeline()` call.

### Backoff Delay Semantics

The `delays` array specifies wait time before each retry attempt: `delays[0]` before retry 1, `delays[1]` before retry 2, etc. If `maxRetries` exceeds `delays.length`, the last delay value is reused for remaining retries.

### Runlog Format

File: `logs/{pipelineName}-{ISO timestamp}.json`

```json
{
  "pipeline": "news-podcast",
  "startedAt": "2026-03-17T06:00:00.000Z",
  "completedAt": "2026-03-17T06:08:42.123Z",
  "success": true,
  "steps": [
    {
      "name": "refresh-auth",
      "type": "auth",
      "status": "success",
      "duration": 1203,
      "attempts": 1
    },
    {
      "name": "add-sources",
      "type": "nlm",
      "status": "skipped",
      "duration": 12450,
      "attempts": 1,
      "warnings": ["Source 2 failed: FAILED_PRECONDITION — skipped per catalog (nlm-source-precondition)"],
      "catalogMatch": "nlm-source-precondition"
    }
  ]
}
```

## Known-Issues Catalog: `known-issues.json`

### Format

```json
{
  "version": 1,
  "issues": [
    {
      "id": "unique-kebab-id",
      "pattern": "regex pattern to match against error message and stack",
      "type": "auth | infrastructure | nlm | config",
      "severity": "critical | high | medium | low",
      "remediation": {
        "automated": true | false,
        "strategy": "backoff | skip",
        "delays": [2000, 5000, 15000],
        "command": "shell command for manual remediation",
        "description": "Human-readable explanation",
        "postAction": "Follow-up instructions after remediation"
      },
      "verified": true | false,
      "addedBy": "manual | claude",
      "addedAt": "ISO date"
    }
  ]
}
```

### Initial Catalog Entries

| ID | Pattern | Strategy | Verified |
|----|---------|----------|----------|
| `nlm-cookie-expiry` | `cookies may have expired\|<!doctype\|login redirect` | Manual: `nlm login` | Yes |
| `supabase-timeout` | `522\|ETIMEDOUT\|EarlyDrop\|fetch failed` | Backoff: 2s, 5s, 15s | Yes |
| `nlm-source-precondition` | `FAILED_PRECONDITION\|error.*9` | Skip | Yes |
| `nlm-rate-limit` | `INVALID_ARGUMENT\|error.*3` | Backoff: 30s, 60s | Yes |
| `supabase-duplicate-key` | `duplicate key\|obsidian_chunks_vault_rel_path` | Manual: delete stale chunks | Yes |
| `env-var-missing` | `NLM_COOKIES.*required\|SUPABASE_URL.*undefined\|ANTHROPIC_API_KEY.*undefined` | Manual: check env/secrets | Yes |

### Catalog Growth Rules

- **Claude adds entries** with `verified: false`, `addedBy: "claude"`, `addedAt: <ISO date>`
- **Unverified entries**: used by Claude skill (interactive) only, never by Node module (unattended)
- **User verifies**: manually sets `verified: true` after confirming the fix works
- **Pattern specificity**: patterns should be specific enough to avoid false matches; prefer exact error messages over generic words

## Claude Code Skill: `SKILL.md`

### Activation

New CARL domain `PIPELINE` with keyword triggers: `pipeline`, `run pipeline`, `article-fodder`, `generate podcast`, `index vault`, `vault indexing`.

### Behavioral Rules

1. **Before each step**: Announce step name and type
2. **On failure**: Before debugging, read `~/.carl/pipeline-runner/known-issues.json` and match the error
   - Match found → follow remediation instructions
   - No match → debug normally
3. **After resolving novel failure**: Ask user "Should I add this to the known-issues catalog?" If yes, append entry with `verified: false`
4. **Retry cap**: Max 2 auto-remediation attempts per step. After 2 failures, stop and ask the user
5. **Logging**: At workflow end, write a runlog JSON to `~/.carl/pipeline-runner/logs/` using the same format as the Node module (see Runlog Format section)
6. **No brute force**: Never retry the same exact approach more than twice. If it didn't work twice, the approach is wrong.

### What the Skill Does NOT Do

- Does not wrap Node.js execution (that's the module's job)
- Does not apply to single-step tasks or simple questions
- Does not override explicit user instructions

## Integration Plan

### News Podcast (`generate.js`)

Wrap existing step functions with `runPipeline()`:

```js
const path = require('path');
const os = require('os');
const { runPipeline } = require(path.join(os.homedir(), '.carl/pipeline-runner/pipeline-runner.js'));

const steps = [
  { name: 'refresh-auth', type: 'auth', fn: async (ctx) => { await nlm.refreshAuth(); } },
  { name: 'fetch-articles', type: 'api', fn: async (ctx) => { ctx.articles = await fetchArticles(topics); } },
  { name: 'create-notebook', type: 'nlm', fn: async (ctx) => { ctx.notebookId = await nlm.createNotebook(title); } },
  { name: 'add-sources', type: 'nlm', fn: async (ctx) => { ctx.sourceIds = await addAllSources(ctx.notebookId, ctx.articles); }, continueOnFail: true },
  { name: 'generate-audio', type: 'nlm-longpoll', fn: async (ctx) => { ctx.audioUrl = await nlm.generateAudio(ctx.notebookId, ctx.sourceIds); } },
];

const result = await runPipeline('news-podcast', steps, {
  onStepFail: async (step, error) => {
    await supabase.from('podcasts').update({
      status: 'failed', error_message: `${step.name}: ${error.message}`
    }).eq('id', podcastId);
  }
});
```

### Phase 2 (`download-audio.js`)

**Important**: `download-audio.js` has a fundamentally different retry model — it retries *across launchd invocations* (6 retries × 5 min = 30 min window via `retry_count` in Supabase). The pipeline runner's retries are *within a single invocation*.

**Approach**: Use the runner for in-process resilience (timeout, catalog matching, runlog) but preserve the cross-invocation retry logic. The runner wraps the download+upload steps within a single launchd invocation. The existing `retry_count` tracking stays as the outer retry loop across invocations.

### Article Fodder

No code changes. The Claude skill handles behavioral discipline when Claude runs the article-fodder workflow.

### Future Pipelines

Any new workflow defines a steps array and calls `runPipeline()`, or relies on the Claude skill if interactive.

## CARL Domain Configuration

Add to `~/.carl/manifest`:

```
PIPELINE_STATE=active
PIPELINE_ALWAYS_ON=false
PIPELINE_RECALL=pipeline,run pipeline,article-fodder,generate podcast,index vault,vault indexing
```

Create `~/.carl/pipeline/rules` with the domain rules referencing the skill.

## Testing Strategy

1. **Unit test the runner**: Mock step functions that succeed, fail with known patterns, fail with unknown patterns, timeout. Verify retry behavior, catalog matching, runlog output.
2. **Integration test with podcast pipeline**: Run generate.js through the runner against a real NLM session. Verify runlog captures all steps.
3. **Manual test Claude skill**: Run article-fodder through Claude, intentionally trigger a known failure (e.g., bad Supabase query). Verify Claude checks the catalog before debugging.

## Success Criteria

- Podcast pipeline runs through the runner with no behavior change on happy path
- Known failures (cookie expiry, Supabase timeout) are caught and remediated automatically
- Runlogs are written for every pipeline execution
- Claude checks the catalog before debugging during interactive workflows
- Novel failures get cataloged (unverified) for future reference
