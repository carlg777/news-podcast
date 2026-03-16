# Desktop Mac Setup — News Podcast Phase 2 Cron

## Context
The News Podcast app uses a two-phase pipeline. Phase 1 (GitHub Actions) generates audio via NotebookLM. Phase 2 runs locally to download the audio and upload to Supabase Storage. The Desktop Mac mini is always on, making it ideal for Phase 2.

> **Path note:** On the Desktop Mac mini, Dropbox mounts at `/Volumes/Dropbox/Dropbox/` not `~/Dropbox/`. All paths below use the `PROJECT_DIR` variable — set it once and the rest just works.

## What needs to happen

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

### 3. Test the download script manually
```bash
node "$PROJECT_DIR/scripts/download-audio.js"
```
Expected output: "No podcasts waiting for download." (if nothing is pending) — this confirms node, modules, and Supabase connection all work.

### 4. Install and load the launchd plist
```bash
launchctl list | grep news-podcast
```
If loaded, you'll see: `- 0 com.news-podcast.download-audio`

If NOT loaded, copy the plist and load it:
```bash
cp "$PROJECT_DIR/com.news-podcast.download-audio.plist" ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.news-podcast.download-audio.plist
```

> **Important:** The plist contains hardcoded paths. If your Dropbox path differs from what's in the plist, edit `~/Library/LaunchAgents/com.news-podcast.download-audio.plist` to update `ProgramArguments` and `WorkingDirectory` before loading.

### 5. Verify cron is running
```bash
launchctl list | grep news-podcast
cat /tmp/news-podcast-download.log
```
The log should show "No podcasts waiting for download." — not MODULE_NOT_FOUND errors.

## Done when
- `node scripts/download-audio.js` runs without errors
- `launchctl list | grep news-podcast` shows exit code `0` (not `1`)
- `/tmp/news-podcast-download.log` shows clean output
