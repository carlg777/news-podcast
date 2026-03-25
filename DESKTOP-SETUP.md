# Desktop Mac Setup — News Podcast Generator

## Architecture

The entire podcast pipeline runs on the Desktop Mac mini. No GitHub Actions dependency.

**Two launchd jobs:**
1. **Poller** (`com.news-podcast.poll-generate.plist`) — runs every 60 seconds, checks for `generating` rows in Supabase, runs the full pipeline (fetch articles, create NotebookLM notebook via `nlm` CLI, generate audio, download, upload to Supabase Storage, mark ready).
2. **Scheduler** (`com.news-podcast.schedule.plist`) — runs at 7:00am, 12:00pm, and 5:00pm daily, inserts a `generating` row with default topics (`ai`, 8 articles) so the poller picks it up.

The Vercel API (`api/trigger.js`) still works for on-demand generation from the web UI — it creates a `generating` row and the desktop poller handles the rest.

> **Path note:** On the Desktop Mac mini, Dropbox mounts at `/Volumes/Dropbox/Dropbox/` not `~/Dropbox/`. The plists use Desktop paths. If setting up on the Laptop, edit the paths in the plist files before loading them.

## Retired files (kept but no longer active)

- `.github/workflows/generate-podcast.yml` — replaced by desktop poller
- `scripts/notebooklm.js` — replaced by `nlm` CLI calls
- `scripts/download-audio.js` — merged into `poll-and-generate.js`
- `com.news-podcast.download-audio.plist` — replaced by new plists

## Setup steps

### 0. Set your project directory

```bash
# Desktop Mac mini (Dropbox on external/virtual volume):
export PROJECT_DIR="/Volumes/Dropbox/Dropbox/425 Websites/Custom News Podcaster"

# Laptop / other Mac (Dropbox in home folder):
# export PROJECT_DIR="$HOME/Dropbox/425 Websites/Custom News Podcaster"
```

### 1. Install node dependencies

```bash
cd "$PROJECT_DIR" && npm install
```

### 2. Verify nlm CLI is installed and authenticated

```bash
which nlm && nlm --version
```

If not installed:
```bash
npm install -g notebooklm-cli
```

Then authenticate (quit Chrome first with Cmd+Q):
```bash
nlm login
```

### 3. Get your ANTHROPIC_API_KEY

The poller needs this for custom query cleanup (via Claude Haiku). Get it from `.env.local` or from the Vercel dashboard.

Edit both plist files and replace `REPLACE_WITH_YOUR_KEY` with the actual key:
```bash
# In com.news-podcast.poll-generate.plist
# In com.news-podcast.schedule.plist
# Find: REPLACE_WITH_YOUR_KEY
# Replace with: sk-ant-...
```

### 4. Test scripts manually

**Test the poller** (should say "No podcasts pending generation." if nothing is queued):
```bash
ANTHROPIC_API_KEY="sk-ant-..." node "$PROJECT_DIR/scripts/poll-and-generate.js"
```

**Test the scheduler** (creates a podcast row):
```bash
node "$PROJECT_DIR/scripts/schedule-podcast.js"
```

Then run the poller again — it should pick up the new row and run the full pipeline.

### 5. Unload old plist (if previously installed)

```bash
launchctl list | grep news-podcast
# If com.news-podcast.download-audio is loaded:
launchctl unload ~/Library/LaunchAgents/com.news-podcast.download-audio.plist
```

### 6. Install and load the new launchd plists

```bash
cp "$PROJECT_DIR/com.news-podcast.poll-generate.plist" ~/Library/LaunchAgents/
cp "$PROJECT_DIR/com.news-podcast.schedule.plist" ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.news-podcast.poll-generate.plist
launchctl load ~/Library/LaunchAgents/com.news-podcast.schedule.plist
```

> **Important:** If your Dropbox path differs from what's in the plists, edit `~/Library/LaunchAgents/com.news-podcast.poll-generate.plist` and `~/Library/LaunchAgents/com.news-podcast.schedule.plist` to update `ProgramArguments` and `WorkingDirectory` before loading.

### 7. Verify everything is running

```bash
launchctl list | grep news-podcast
```

Expected output:
```
-  0  com.news-podcast.poll-generate
-  0  com.news-podcast.schedule
```

### 8. Check logs

```bash
# Poller log (runs every 60s)
tail -f /tmp/news-podcast-generate.log

# Scheduler log (runs 3x daily)
cat /tmp/news-podcast-schedule.log
```

The poller log should show `No podcasts pending generation.` when idle, and full pipeline output when processing.

## Troubleshooting

- **Exit code 1 in launchctl list:** Check the log files for errors. Common issues: missing `node_modules`, expired `nlm` auth, missing `ANTHROPIC_API_KEY`.
- **nlm auth expired:** Run `nlm login` (quit Chrome first). The launchd job will pick up the new auth automatically.
- **Double generation:** The scheduler has a 30-minute rate limit. The trigger API has a 10-minute rate limit. Both prevent duplicate podcasts.
