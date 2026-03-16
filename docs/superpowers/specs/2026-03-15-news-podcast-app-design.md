# News Podcast App — Design Spec

## Overview

A standalone web app that generates daily AI-powered news podcasts using Google NotebookLM. Users select topics, the system fetches articles from curated RSS feeds, creates a NotebookLM notebook with those articles as sources, generates a conversational podcast (two AI hosts), and presents the audio for in-browser playback. Optimized for iPhone Safari.

**Inspired by:** "I Stopped Reading AI News. I Built This Instead." by Everyday AI with Tristen ([YouTube](https://www.youtube.com/watch?v=3dqocMfH72o))

## Architecture: Hybrid (Vercel + GitHub Actions)

### Why Hybrid

NotebookLM podcast generation requires polling `studio_status` for several minutes until audio is complete. Vercel's serverless function timeout (10s free / 60s pro) is too short. GitHub Actions allows runs up to 10+ minutes with free cron scheduling.

### Component Responsibilities

**Vercel (Frontend + Lightweight API)**
- Serves static frontend (vanilla HTML/CSS/JS)
- `GET /api/podcasts` — reads podcast list from Supabase (last 7 days)
- `GET /api/status/:id` — reads single podcast status from Supabase
- `POST /api/trigger` — fires GitHub Actions workflow via `workflow_dispatch` API

**GitHub Actions (Generation Pipeline)**
- `generate-podcast.yml` workflow
- Triggers: `schedule` (cron `0 6 * * *` for 6am daily) + `workflow_dispatch` (on-demand via API)
- Runs the full pipeline: RSS → Claude Haiku → NotebookLM → Supabase
- No timeout concerns — runs as long as needed

**Supabase (Data Store + Audio Storage)**
- Stores podcast metadata, article lists, audio files
- **Supabase Storage bucket** (`podcast-audio`) holds the downloaded MP3 files as permanent URLs
- Read by frontend via Supabase REST API or Vercel API routes
- Written by GitHub Actions pipeline

## Topic Cards

Seven predefined topics plus a custom search:

| Topic | Icon | RSS Sources | Default Articles |
|-------|------|-------------|-----------------|
| AI | 🤖 | OpenAI Blog, Anthropic Blog, Google DeepMind, Google AI, TechCrunch AI, The Verge AI, MIT Tech Review | 8 |
| Tech | 💻 | TechCrunch, The Verge, Ars Technica, Wired | 5 |
| Gadgets | 📱 | The Verge (gadgets), Engadget, CNET | 5 |
| World | 🌍 | Reuters, AP News, BBC World | 5 |
| US News | 🇺🇸 | AP News (US), NPR, PBS NewsHour | 5 |
| Local News | 📍 | Configurable per deployment (hardcoded city/region) | 5 |
| Custom | ✨ | News API search (query cleaned by Claude Haiku) | 5 |

Article count is adjustable per-session via +/- stepper.

## Custom Topic Flow

1. User types a messy search query (e.g., "elctric vehicls news")
2. System sends input to Claude Haiku (claude-haiku-4-5-20251001)
3. Haiku returns two cleaned queries: one specific, one broad fallback
4. System searches News API with the specific query first
5. Time window: yesterday → last week → last month (progressive fallback)
6. If specific query returns nothing, tries the broad query
7. Returns up to N articles matching the user's intent

## Database Schema

### Table: `podcasts`

| Column | Type | Description |
|--------|------|-------------|
| id | uuid (PK) | Auto-generated, default `gen_random_uuid()` |
| topics | text[] | Selected topic names, e.g., `["AI", "Tech"]` |
| custom_query | text | Raw custom topic input (nullable) |
| article_count | int | Total articles sourced |
| articles | jsonb | Array of `{title, source, url}` objects |
| audio_url | text | NotebookLM audio download URL (nullable until ready) |
| notebook_id | text | NotebookLM notebook ID (for cleanup) |
| duration_seconds | int | Podcast length in seconds (nullable until ready) |
| status | text | `generating` / `ready` / `failed` |
| error_message | text | Error details if status is `failed` (nullable) |
| created_at | timestamptz | Default `now()` |

**RLS Policy:** Anon read access (same pattern as existing dashboard). Write access via service role key (used by GitHub Actions).

**Cleanup:** Podcasts older than 7 days are deleted by a cleanup step in the GitHub Actions workflow. Their corresponding NotebookLM notebooks are also deleted via `notebook_delete`.

## API Routes (Vercel)

### `GET /api/podcasts`

Returns podcasts from the last 7 days, ordered by `created_at` desc.

Response: `{ podcasts: [{ id, topics, article_count, articles, audio_url, duration_seconds, status, created_at }] }`

### `GET /api/status/:id`

Returns a single podcast's current status.

Response: `{ id, status, audio_url, duration_seconds, error_message }`

### `POST /api/trigger`

Accepts: `{ topics: string[], customQuery?: string, articleCount?: number }`

**Authentication:** Requires `x-api-key` header matching the `TRIGGER_API_KEY` env var. This prevents unauthorized generation requests.

**Rate limiting:** Max 1 generation per 10 minutes. Checks Supabase for any podcast with `status = "generating"` or `created_at` within the last 10 minutes before proceeding.

Fires the GitHub Actions `generate-podcast.yml` workflow via the GitHub API (`workflow_dispatch` event), passing the request body as workflow inputs.

Creates a Supabase row with `status: "generating"` and returns the podcast ID so the frontend can poll `/api/status/:id`.

Requires: `GITHUB_TOKEN` env var with `repo` scope.

## GitHub Actions Workflow

### `generate-podcast.yml`

**Triggers:**
- `schedule: cron '0 6 * * *'` — daily at 6am UTC (adjust for timezone)
- `workflow_dispatch` — on-demand with inputs: `topics`, `customQuery`, `articleCount`, `podcastId`

**Environment Secrets:**
- `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`
- `ANTHROPIC_API_KEY` (for Claude Haiku)
- `NEWS_API_KEY` (for custom topic search)
- `NLM_ACCESS_TOKEN`, `NLM_REFRESH_TOKEN` (NotebookLM OAuth2 — see Auth section below)

**Pipeline Steps:**

1. **Parse inputs** — if cron trigger, use default topics (e.g., `["AI"]`). If dispatch, use provided inputs. If no `podcastId`, create a new Supabase row.

2. **Fetch RSS articles** — for each topic, fetch from curated RSS feeds in parallel. Filter to articles from last 3 days (fallback to last week, then last month). Limit to `articleCount` per topic. Collect `{title, source, url}` for each. If a topic yields 0 articles, skip it and log a warning. **Deduplicate** collected articles by URL across all topics before proceeding.

3. **Clean custom query** (if custom topic selected) — call Anthropic API with Claude Haiku. Prompt returns JSON: `{ specific: "...", broad: "..." }`. Search News API with specific query first, broad as fallback. Progressive time window.

4. **Update Supabase** — write article list to the podcast row.

5. **Create NotebookLM notebook** — use the `nlm` CLI (installed as a dependency) to create a notebook titled "News Podcast — Mar 15, 2026". The CLI handles OAuth2 token refresh automatically.

6. **Add sources** — for each article, use `nlm` to add the URL as a source. NotebookLM will fetch and index the content.

7. **Generate audio** — use `nlm` to create an audio artifact. Then poll status every 15 seconds until complete.

8. **Download audio** — use `nlm` to download the audio file. Upload the MP3 to **Supabase Storage** (`podcast-audio` bucket) to get a permanent public URL. NotebookLM's native URLs are temporary and may expire.

9. **Update Supabase** — set `audio_url` (Supabase Storage URL), `status = "ready"`. The `duration_seconds` field is populated by the frontend from the `<audio>` element's `loadedmetadata` event (optional — not critical for playback).

10. **Cleanup old podcasts** — query Supabase for podcasts older than 7 days. For each: delete audio file from Supabase Storage, delete NotebookLM notebook via `nlm`, then delete the Supabase row.

**Error handling:** If any step fails, update Supabase row with `status = "failed"` and `error_message`. The frontend shows the error state.

## NotebookLM Integration

### Approach: `nlm` CLI

The generate script uses the `nlm` CLI tool (npm package) rather than calling MCP tools directly. MCP servers communicate over stdio with a host and are not importable as libraries. The `nlm` CLI wraps the NotebookLM API and handles authentication, token refresh, and all operations (create notebook, add sources, generate audio, download artifacts, delete notebooks).

### Authentication

NotebookLM uses OAuth2 with Google accounts. The `nlm` CLI manages token lifecycle:

1. **Initial setup:** Run `nlm login` once locally to authenticate and generate tokens
2. **Token storage:** The CLI stores tokens in its config directory
3. **For GitHub Actions:** Store the refresh token as `NLM_REFRESH_TOKEN` secret. The generate script runs `nlm login refresh` at the start of each pipeline run to get a fresh access token
4. **Token refresh is automatic** — the refresh token is long-lived and the CLI handles obtaining new access tokens

If token refresh fails (e.g., Google account permissions revoked), the pipeline sets `status = "failed"` with an appropriate error message.

## Frontend

### Tech Stack

- Vanilla HTML/CSS/JS (matching existing dashboard approach — zero dependencies)
- Dark theme with purple accent (#7c3aed)
- CSS variables for theming
- iPhone-optimized (390px target width, touch-friendly)
- Google Fonts: Inter

### Design Notes

- Text contrast: secondary text uses #aaa/#999 (not #888/#666) for readability
- All interactive elements have minimum 44px touch targets
- No framework, no build step

### Screens

**1. Topic Picker (main screen)**
- Header: "News Podcast" label + today's date
- 2-column grid of 7 topic cards
- Each card: emoji icon, topic name, short description
- Tapping a card toggles selection (purple border + glow + article count badge)
- Custom topic card spans full width with text input
- Article count stepper (−/5/+)
- "Generate Podcast" button (purple gradient)
- "Previous podcasts" link at bottom

**2. Generating State**
- Same layout but Generate button replaced with progress indicator
- Status text updates: "Fetching articles..." → "Creating podcast..." → "Generating audio..."
- Polls `/api/status/:id` every 5 seconds
- Auto-transitions to player when status = "ready"

**3. Audio Player**
- Compact inline player with play/pause button + progress bar + time display
- Speed controls: 0.5x, 1x, 1.5x, 2x
- Skip forward/back buttons (15s increments)
- Below player: "Sources" section listing all articles with source badge + title
- "← New podcast" link to return to topic picker
- Uses HTML5 `<audio>` element

**4. History (Previous Podcasts)**
- Header with back arrow
- Scrollable list of podcasts from last 7 days
- Each entry: date, topic tags, duration, article count, play button
- Today's podcast highlighted with purple border
- Tapping an entry opens its audio player
- Footer note: "Podcasts older than 7 days are automatically removed"

### Navigation Flow

```
Topic Picker → Generating → Audio Player
     ↕                          ↕
  History ←————————————————————→
```

Single-page app with state-based view switching (no router needed).

## Project Structure

```
news-podcast/
├── index.html              # Single HTML file
├── styles.css              # All styles
├── app.js                  # Frontend logic
├── api/
│   ├── podcasts.js         # GET /api/podcasts
│   ├── status/[id].js      # GET /api/status/:id
│   └── trigger.js          # POST /api/trigger
├── .github/
│   └── workflows/
│       └── generate-podcast.yml
├── scripts/
│   └── generate.js         # Pipeline logic (used by GitHub Actions)
├── vercel.json             # Vercel config + cron
├── package.json            # Dependencies for API routes + scripts
└── .env.example            # Required env vars
```

## Dependencies

**Runtime (minimal):**
- `@supabase/supabase-js` — Supabase client (API routes + generate script)
- `@anthropic-ai/sdk` — Claude Haiku for query cleaning
- `rss-parser` — RSS feed parsing
- `notebooklm-cli` — NotebookLM CLI for notebook/audio operations

**No frontend dependencies.** Vanilla JS only.

## Notes & Constraints

- **This is a new GitHub repository** — not a subdirectory of `open-brain-dashboard`. It shares Supabase but has its own Vercel project.
- **Vercel project type:** Node.js (not static), since API routes require a runtime. The `vercel.json` catch-all rewrite must exclude `/api/*` paths.
- **News API free tier:** 100 requests/day. Custom topics use 1-2 requests each. If quota is exhausted, custom topic returns an error and the user is notified. Predefined topics use RSS (no News API quota).
- **Cron default topics:** Stored as a config constant in `scripts/generate.js`. To change cron topics, edit the file and push. Future enhancement: store preferences in Supabase.

## Environment Variables

| Variable | Used By | Description |
|----------|---------|-------------|
| `SUPABASE_URL` | Vercel + GitHub Actions | Supabase project URL |
| `SUPABASE_ANON_KEY` | Frontend (app.js) | Public anon key for reads |
| `SUPABASE_SERVICE_KEY` | GitHub Actions | Service role key for writes |
| `ANTHROPIC_API_KEY` | GitHub Actions | Claude Haiku API access |
| `NEWS_API_KEY` | GitHub Actions | News API for custom topics |
| `GITHUB_TOKEN` | Vercel (trigger route) | Fires workflow_dispatch |
| `NLM_REFRESH_TOKEN` | GitHub Actions | NotebookLM OAuth2 refresh token |
| `TRIGGER_API_KEY` | Vercel | Shared secret for `/api/trigger` auth |
| `LOCAL_NEWS_LOCATION` | GitHub Actions | City/region for local news RSS |

## Success Criteria

1. User can select topics and generate a podcast from the iPhone browser
2. Podcast audio plays inline with speed controls
3. 6am cron generates a podcast automatically with default topics
4. Source articles are listed below the player
5. Last 7 days of podcasts are accessible in history
6. Custom topic accepts messy input and returns relevant articles
7. Generation completes within ~5 minutes end-to-end
8. Older podcasts and their NotebookLM notebooks are cleaned up automatically
