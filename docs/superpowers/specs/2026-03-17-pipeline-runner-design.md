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
const { runPipeline } = require('/Users/carlgerber/.carl/pipeline-runner/pipeline-runner.js');

const result = await runPipeline(pipelineName, steps, options);
```

**Parameters:**

- `pipelineName` (string) — identifier for logging (e.g., `'news-podcast'`)
- `steps` (array) — ordered step definitions
- `options` (object) — optional overrides

**Step Definition:**

```js
{
  name: 'add-sources',        // Human-readable step name
  type: 'nlm',                // Maps to timeout defaults
  fn: async () => { ... },    // The actual work (returns any value)
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
     b. First matching issue wins
     c. If match found AND remediation.automated === true AND issue.verified === true:
        - Execute remediation strategy:
          - 'backoff': retry step after delays from remediation.delays array
          - 'skip': log warning, mark step as 'skipped', continue pipeline
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
```

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
      "status": "partial",
      "duration": 12450,
      "attempts": 2,
      "warnings": ["Source 2 failed: FAILED_PRECONDITION — skipped per catalog"],
      "remediation": "nlm-source-precondition"
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

New CARL domain `PIPELINE` with keyword triggers: `pipeline`, `run pipeline`, `article-fodder`, `generate podcast`, `index vault`, `vault indexing`, `dashboard sync`.

### Behavioral Rules

1. **Before each step**: Announce step name and type
2. **On failure**: Before debugging, read `~/.carl/pipeline-runner/known-issues.json` and match the error
   - Match found → follow remediation instructions
   - No match → debug normally
3. **After resolving novel failure**: Ask user "Should I add this to the known-issues catalog?" If yes, append entry with `verified: false`
4. **Retry cap**: Max 2 auto-remediation attempts per step. After 2 failures, stop and ask the user
5. **Logging**: At workflow end, write a runlog JSON to `~/.carl/pipeline-runner/logs/`
6. **No brute force**: Never retry the same exact approach more than twice. If it didn't work twice, the approach is wrong.

### What the Skill Does NOT Do

- Does not wrap Node.js execution (that's the module's job)
- Does not apply to single-step tasks or simple questions
- Does not override explicit user instructions

## Integration Plan

### News Podcast (`generate.js`)

Wrap existing step functions with `runPipeline()`:

```js
const { runPipeline } = require('/Users/carlgerber/.carl/pipeline-runner/pipeline-runner.js');

const steps = [
  { name: 'refresh-auth', type: 'auth', fn: () => nlm.refreshAuth() },
  { name: 'fetch-articles', type: 'api', fn: () => fetchArticles(topics) },
  { name: 'create-notebook', type: 'nlm', fn: () => nlm.createNotebook(title) },
  { name: 'add-sources', type: 'nlm', fn: () => addAllSources(articles), continueOnFail: true },
  { name: 'generate-audio', type: 'nlm-longpoll', fn: () => nlm.generateAudio(notebookId, sourceIds) },
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

Replace existing retry logic with the runner. The `retry_count` column in Supabase is updated via the `onStepFail` callback.

### Article Fodder

No code changes. The Claude skill handles behavioral discipline when Claude runs the article-fodder workflow.

### Future Pipelines

Any new workflow defines a steps array and calls `runPipeline()`, or relies on the Claude skill if interactive.

## CARL Domain Configuration

Add to `~/.carl/manifest`:

```
PIPELINE_STATE=active
PIPELINE_ALWAYS_ON=false
PIPELINE_RECALL=pipeline,run pipeline,article-fodder,generate podcast,index vault,vault indexing,dashboard sync
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
