# News Podcast App Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a web app that generates daily AI-powered news podcasts via NotebookLM, with topic selection, audio playback, and history — optimized for iPhone Safari.

**Architecture:** Vercel serves vanilla HTML/CSS/JS frontend + lightweight API routes. GitHub Actions runs the long-running generation pipeline (RSS fetch, Claude Haiku query cleanup, NotebookLM podcast generation). Supabase stores podcast metadata and audio files.

**Tech Stack:** Vanilla HTML/CSS/JS (no framework), Vercel serverless functions, GitHub Actions, Supabase (Postgres + Storage), `rss-parser`, `@anthropic-ai/sdk`, `@supabase/supabase-js`, `nlm` CLI for NotebookLM.

**Spec:** `docs/superpowers/specs/2026-03-15-news-podcast-app-design.md`

---

## File Structure

```
news-podcast/
├── index.html                    # Single-page app (all 4 views)
├── styles.css                    # All styles, CSS variables, dark theme
├── app.js                        # Frontend logic, view switching, API calls
├── api/
│   ├── podcasts.js               # GET /api/podcasts — list last 7 days
│   ├── status/[id].js            # GET /api/status/:id — poll single podcast
│   └── trigger.js                # POST /api/trigger — fire GitHub Actions
├── .github/
│   └── workflows/
│       └── generate-podcast.yml  # Generation pipeline workflow
├── scripts/
│   ├── generate.js               # Main pipeline logic
│   ├── rss-feeds.js              # RSS feed config + fetch logic
│   ├── custom-query.js           # Claude Haiku query cleanup
│   └── notebooklm.js             # NotebookLM operations (create, source, generate, download)
├── docs/
│   └── supabase-setup.sql        # Database schema + RLS setup
├── vercel.json                   # Vercel routing config
├── package.json                  # Dependencies
├── .env.example                  # Required env vars template
└── .gitignore                    # Node modules, .env, etc.
```

---

## Chunk 1: Project Scaffolding + Frontend (Static UI)

### Task 1: Project scaffolding

**Files:**
- Create: `package.json`
- Create: `vercel.json`
- Create: `.env.example`
- Create: `.gitignore`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "news-podcast",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "description": "AI-powered daily news podcast generator using NotebookLM",
  "scripts": {
    "generate": "node scripts/generate.js"
  },
  "dependencies": {
    "@supabase/supabase-js": "^2.45.0",
    "@anthropic-ai/sdk": "^0.39.0",
    "rss-parser": "^3.13.0",
    "notebooklm-cli": "^1.0.0"
  }
}
```

- [ ] **Step 2: Create vercel.json**

```json
{
  "rewrites": [
    { "source": "/api/(.*)", "destination": "/api/$1" },
    { "source": "/(.*)", "destination": "/index.html" }
  ]
}
```

- [ ] **Step 3: Create .env.example**

```
# Supabase
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_KEY=

# GitHub (for trigger route to fire workflow_dispatch)
GITHUB_TOKEN=
GITHUB_REPO=owner/news-podcast

# Anthropic (for Claude Haiku query cleanup)
ANTHROPIC_API_KEY=

# News API (for custom topic search)
NEWS_API_KEY=

# NotebookLM (OAuth2 refresh token)
NLM_REFRESH_TOKEN=

# Trigger auth
TRIGGER_API_KEY=

# Local news
LOCAL_NEWS_LOCATION=
```

- [ ] **Step 4: Create .gitignore**

```
node_modules/
.env
.vercel
.DS_Store
```

- [ ] **Step 5: Install dependencies**

Run: `npm install`

- [ ] **Step 6: Commit**

```bash
git add package.json vercel.json .env.example .gitignore
git commit -m "chore: project scaffolding with package.json, vercel.json, env template"
```

---

### Task 2: Frontend — HTML structure (all 4 views)

**Files:**
- Create: `index.html`

The single HTML file contains all 4 views as `<section>` elements toggled by JS. Only one is visible at a time.

- [ ] **Step 1: Create index.html with all view sections**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <title>News Podcast</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/styles.css">
</head>
<body>
  <!-- View 1: Topic Picker -->
  <section id="view-picker" class="view active">
    <header class="picker-header">
      <div>
        <span class="label">News Podcast</span>
        <p class="subtitle">Two AI hosts discuss today's top stories</p>
      </div>
      <div class="header-right">
        <span class="date" id="today-date"></span>
      </div>
    </header>

    <div class="topic-grid" id="topic-grid">
      <!-- Topic cards rendered by JS -->
    </div>

    <div class="custom-input-row" id="custom-input-row" style="display:none;">
      <input type="text" id="custom-query-input" placeholder="Search any topic..." autocomplete="off">
    </div>

    <div class="article-stepper">
      <span class="stepper-label">Articles to source</span>
      <div class="stepper-controls">
        <button class="stepper-btn" id="stepper-minus">−</button>
        <span class="stepper-value" id="stepper-value">5</span>
        <button class="stepper-btn" id="stepper-plus">+</button>
      </div>
    </div>

    <button class="generate-btn" id="generate-btn">Generate Podcast</button>

    <a href="#" class="history-link" id="show-history">🎧 Previous podcasts</a>
  </section>

  <!-- View 2: Generating State -->
  <section id="view-generating" class="view">
    <div class="generating-container">
      <div class="generating-spinner"></div>
      <p class="generating-status" id="generating-status">Fetching articles...</p>
      <p class="generating-sub">This usually takes 2-4 minutes</p>
      <button class="cancel-btn" id="cancel-btn">Cancel</button>
    </div>
  </section>

  <!-- View 3: Audio Player -->
  <section id="view-player" class="view">
    <a href="#" class="back-link" id="back-to-picker">← New podcast</a>

    <div class="player-card">
      <div class="player-meta">
        <span class="player-date" id="player-date"></span>
        <div class="player-topics" id="player-topics"></div>
      </div>

      <audio id="audio-element" preload="metadata"></audio>

      <div class="player-controls">
        <button class="skip-btn" id="skip-back">
          <span class="skip-icon">↺</span>
          <span class="skip-label">15</span>
        </button>
        <button class="play-btn" id="play-btn">▶</button>
        <button class="skip-btn" id="skip-forward">
          <span class="skip-icon">↻</span>
          <span class="skip-label">15</span>
        </button>
      </div>

      <div class="progress-container" id="progress-container">
        <div class="progress-bar" id="progress-bar"></div>
      </div>
      <div class="time-display">
        <span id="time-current">0:00</span>
        <span id="time-total">0:00</span>
      </div>

      <div class="speed-controls">
        <button class="speed-btn" data-speed="0.5">0.5x</button>
        <button class="speed-btn active" data-speed="1">1x</button>
        <button class="speed-btn" data-speed="1.5">1.5x</button>
        <button class="speed-btn" data-speed="2">2x</button>
      </div>
    </div>

    <div class="sources-section">
      <h3 class="sources-title">Sources</h3>
      <div class="sources-list" id="sources-list">
        <!-- Rendered by JS -->
      </div>
    </div>
  </section>

  <!-- View 4: History -->
  <section id="view-history" class="view">
    <header class="history-header">
      <a href="#" class="back-link" id="back-from-history">← Back</a>
      <h2>Previous Podcasts</h2>
    </header>

    <div class="history-list" id="history-list">
      <!-- Rendered by JS -->
    </div>

    <p class="history-footer">Podcasts older than 7 days are automatically removed</p>
  </section>

  <script src="/app.js"></script>
</body>
</html>
```

- [ ] **Step 2: Verify HTML loads in browser**

Run: `npx serve . -l 3000` and open `http://localhost:3000` in browser. Verify blank page loads without console errors.

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat: add HTML structure with all 4 view sections"
```

---

### Task 3: Frontend — CSS styles (dark theme, iPhone-optimized)

**Files:**
- Create: `styles.css`

- [ ] **Step 1: Create styles.css with CSS variables and full layout**

```css
:root {
  --bg: #0a0a0f;
  --surface: #141420;
  --surface-hover: #1a1a2e;
  --border: #2a2a3d;
  --text: #f0f0f5;
  --text-secondary: #aaaaaa;
  --text-muted: #999999;
  --accent: #7c3aed;
  --accent-glow: rgba(124, 58, 237, 0.3);
  --accent-gradient: linear-gradient(135deg, #7c3aed, #9333ea);
  --danger: #ef4444;
  --success: #22c55e;
  --radius: 12px;
  --radius-sm: 8px;
  --font: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
}

* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
  -webkit-tap-highlight-color: transparent;
}

body {
  font-family: var(--font);
  background: var(--bg);
  color: var(--text);
  min-height: 100dvh;
  max-width: 430px;
  margin: 0 auto;
  padding: 16px;
  padding-top: env(safe-area-inset-top, 16px);
  padding-bottom: env(safe-area-inset-bottom, 16px);
}

.view {
  display: none;
}
.view.active {
  display: block;
}

/* --- Topic Picker --- */
.picker-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 20px;
}
.picker-header .label {
  font-size: 24px;
  font-weight: 700;
}
.picker-header .subtitle {
  font-size: 13px;
  color: var(--text-secondary);
  margin-top: 4px;
}
.header-right {
  text-align: right;
}
.date {
  font-size: 13px;
  color: var(--text-secondary);
}

.topic-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  margin-bottom: 12px;
}
.topic-card {
  background: var(--surface);
  border: 2px solid var(--border);
  border-radius: var(--radius);
  padding: 14px;
  cursor: pointer;
  transition: all 0.2s ease;
  position: relative;
  min-height: 80px;
}
.topic-card:active {
  transform: scale(0.97);
}
.topic-card.selected {
  border-color: var(--accent);
  box-shadow: 0 0 16px var(--accent-glow);
}
.topic-card .topic-icon {
  font-size: 22px;
  margin-bottom: 6px;
}
.topic-card .topic-name {
  font-size: 14px;
  font-weight: 600;
}
.topic-card .topic-desc {
  font-size: 11px;
  color: var(--text-secondary);
  margin-top: 2px;
  line-height: 1.3;
}
.topic-card .article-badge {
  display: none;
  position: absolute;
  top: -6px;
  right: -6px;
  background: var(--accent);
  color: white;
  font-size: 11px;
  font-weight: 600;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  align-items: center;
  justify-content: center;
}
.topic-card.selected .article-badge {
  display: flex;
}

/* Custom card spans full width */
.topic-card.custom-card {
  grid-column: 1 / -1;
}

/* Custom input */
.custom-input-row {
  margin-bottom: 12px;
}
.custom-input-row input {
  width: 100%;
  background: var(--surface);
  border: 2px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 12px 14px;
  color: var(--text);
  font-family: var(--font);
  font-size: 15px;
  outline: none;
  transition: border-color 0.2s;
}
.custom-input-row input:focus {
  border-color: var(--accent);
}
.custom-input-row input::placeholder {
  color: var(--text-muted);
}

/* Article stepper */
.article-stepper {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
  padding: 0 4px;
}
.stepper-label {
  font-size: 14px;
  color: var(--text-secondary);
}
.stepper-controls {
  display: flex;
  align-items: center;
  gap: 12px;
}
.stepper-btn {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  border: 2px solid var(--border);
  background: var(--surface);
  color: var(--text);
  font-size: 18px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s;
}
.stepper-btn:active {
  background: var(--surface-hover);
}
.stepper-value {
  font-size: 18px;
  font-weight: 600;
  min-width: 24px;
  text-align: center;
  color: var(--accent);
}

/* Generate button */
.generate-btn {
  width: 100%;
  padding: 16px;
  border: none;
  border-radius: var(--radius);
  background: var(--accent-gradient);
  color: white;
  font-family: var(--font);
  font-size: 16px;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.2s, transform 0.1s;
  min-height: 52px;
}
.generate-btn:active {
  transform: scale(0.98);
}
.generate-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  transform: none;
}

.history-link {
  display: block;
  text-align: center;
  margin-top: 16px;
  color: var(--text-muted);
  font-size: 13px;
  text-decoration: none;
}

/* --- Generating State --- */
.generating-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 60dvh;
  text-align: center;
}
.generating-spinner {
  width: 48px;
  height: 48px;
  border: 3px solid var(--border);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 1s linear infinite;
  margin-bottom: 20px;
}
@keyframes spin {
  to { transform: rotate(360deg); }
}
.generating-status {
  font-size: 18px;
  font-weight: 600;
  margin-bottom: 8px;
}
.generating-sub {
  font-size: 13px;
  color: var(--text-muted);
  margin-bottom: 24px;
}
.cancel-btn {
  background: none;
  border: 1px solid var(--border);
  color: var(--text-secondary);
  padding: 10px 24px;
  border-radius: var(--radius-sm);
  font-family: var(--font);
  font-size: 14px;
  cursor: pointer;
}

/* --- Audio Player --- */
.back-link {
  display: inline-block;
  color: var(--text-secondary);
  text-decoration: none;
  font-size: 14px;
  margin-bottom: 16px;
  padding: 4px 0;
}

.player-card {
  background: var(--surface);
  border-radius: var(--radius);
  padding: 20px;
  margin-bottom: 20px;
}
.player-meta {
  margin-bottom: 20px;
}
.player-date {
  font-size: 13px;
  color: var(--text-muted);
}
.player-topics {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}
.player-topics .tag {
  background: var(--accent-glow);
  color: var(--accent);
  font-size: 12px;
  font-weight: 500;
  padding: 4px 10px;
  border-radius: 20px;
}

.player-controls {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 24px;
  margin-bottom: 16px;
}
.play-btn {
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background: var(--accent-gradient);
  border: none;
  color: white;
  font-size: 22px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: transform 0.1s;
}
.play-btn:active {
  transform: scale(0.95);
}
.skip-btn {
  background: none;
  border: none;
  color: var(--text-secondary);
  font-size: 18px;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 8px;
  min-width: 44px;
  min-height: 44px;
}
.skip-label {
  font-size: 10px;
  margin-top: 2px;
}

.progress-container {
  width: 100%;
  height: 4px;
  background: var(--border);
  border-radius: 2px;
  cursor: pointer;
  margin-bottom: 6px;
}
.progress-bar {
  height: 100%;
  background: var(--accent);
  border-radius: 2px;
  width: 0%;
  transition: width 0.1s linear;
}
.time-display {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: var(--text-muted);
  margin-bottom: 12px;
}

.speed-controls {
  display: flex;
  justify-content: center;
  gap: 8px;
}
.speed-btn {
  background: var(--surface-hover);
  border: 1px solid var(--border);
  color: var(--text-secondary);
  font-family: var(--font);
  font-size: 12px;
  padding: 6px 12px;
  border-radius: 20px;
  cursor: pointer;
  min-height: 32px;
}
.speed-btn.active {
  background: var(--accent);
  border-color: var(--accent);
  color: white;
}

/* Sources */
.sources-title {
  font-size: 16px;
  font-weight: 600;
  margin-bottom: 12px;
}
.sources-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.source-item {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  padding: 10px 12px;
  background: var(--surface);
  border-radius: var(--radius-sm);
  text-decoration: none;
  color: var(--text);
  transition: background 0.15s;
}
.source-item:active {
  background: var(--surface-hover);
}
.source-badge {
  background: var(--surface-hover);
  color: var(--text-secondary);
  font-size: 10px;
  font-weight: 500;
  padding: 3px 8px;
  border-radius: 4px;
  white-space: nowrap;
  flex-shrink: 0;
  margin-top: 2px;
}
.source-title {
  font-size: 13px;
  line-height: 1.4;
}

/* --- History --- */
.history-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 20px;
}
.history-header h2 {
  font-size: 20px;
  font-weight: 700;
}
.history-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.history-item {
  background: var(--surface);
  border: 2px solid var(--border);
  border-radius: var(--radius);
  padding: 14px;
  cursor: pointer;
  transition: all 0.15s;
}
.history-item:active {
  background: var(--surface-hover);
}
.history-item.today {
  border-color: var(--accent);
}
.history-item .history-date {
  font-size: 13px;
  color: var(--text-muted);
  margin-bottom: 6px;
}
.history-item .history-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-bottom: 6px;
}
.history-item .history-tags .tag {
  background: var(--surface-hover);
  color: var(--text-secondary);
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 12px;
}
.history-item .history-meta {
  font-size: 12px;
  color: var(--text-muted);
}

.history-footer {
  text-align: center;
  font-size: 12px;
  color: var(--text-muted);
  margin-top: 24px;
  padding-bottom: 20px;
}
```

- [ ] **Step 2: Verify styles render correctly**

Run: `npx serve . -l 3000` and open in browser. Verify dark background, no layout errors.

- [ ] **Step 3: Commit**

```bash
git add styles.css
git commit -m "feat: add dark theme CSS with iPhone-optimized layout"
```

---

### Task 4: Frontend — app.js (view switching, topic selection, audio player)

**Files:**
- Create: `app.js`

This task builds all frontend JS: topic card rendering, selection logic, article stepper, view switching, audio player, and API integration.

- [ ] **Step 1: Create app.js with full frontend logic**

```js
// --- Config ---
const SUPABASE_URL = ''; // Set in production
const SUPABASE_ANON_KEY = ''; // Set in production
const TRIGGER_API_KEY = ''; // Set in production

const TOPICS = [
  { id: 'ai', name: 'AI', icon: '🤖', desc: 'Latest breakthroughs in artificial intelligence', defaultArticles: 8 },
  { id: 'tech', name: 'Tech', icon: '💻', desc: 'Silicon Valley and the tech industry', defaultArticles: 5 },
  { id: 'gadgets', name: 'Gadgets', icon: '📱', desc: 'New devices, reviews, and gear drops', defaultArticles: 5 },
  { id: 'world', name: 'World', icon: '🌍', desc: 'International news and global events', defaultArticles: 5 },
  { id: 'us-news', name: 'US News', icon: '🇺🇸', desc: 'Top stories across the United States', defaultArticles: 5 },
  { id: 'local', name: 'Local News', icon: '📍', desc: 'Stories from your area', defaultArticles: 5 },
  { id: 'custom', name: 'Custom', icon: '✨', desc: 'Pick any topic and AI finds the news', defaultArticles: 5 },
];

// --- State ---
let selectedTopics = new Set();
let articleCount = 5;
let currentPodcast = null;
let pollInterval = null;

// --- DOM refs ---
const views = {
  picker: document.getElementById('view-picker'),
  generating: document.getElementById('view-generating'),
  player: document.getElementById('view-player'),
  history: document.getElementById('view-history'),
};

// --- View switching ---
function showView(name) {
  Object.values(views).forEach(v => v.classList.remove('active'));
  views[name].classList.add('active');
}

// --- Date formatting ---
function formatDate(date) {
  return new Date(date).toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });
}
function formatShortDate(date) {
  return new Date(date).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
  });
}
function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// --- Topic cards ---
function renderTopicCards() {
  const grid = document.getElementById('topic-grid');
  grid.innerHTML = TOPICS.map(t => `
    <div class="topic-card ${t.id === 'custom' ? 'custom-card' : ''}"
         data-topic="${t.id}" role="button" tabindex="0">
      <div class="article-badge">${t.defaultArticles}</div>
      <div class="topic-icon">${t.icon}</div>
      <div class="topic-name">${t.name}</div>
      <div class="topic-desc">${t.desc}</div>
    </div>
  `).join('');

  grid.addEventListener('click', (e) => {
    const card = e.target.closest('.topic-card');
    if (!card) return;
    const topicId = card.dataset.topic;
    toggleTopic(topicId);
  });
}

function toggleTopic(topicId) {
  if (selectedTopics.has(topicId)) {
    selectedTopics.delete(topicId);
  } else {
    selectedTopics.add(topicId);
  }
  updateTopicUI();
}

function updateTopicUI() {
  document.querySelectorAll('.topic-card').forEach(card => {
    const topicId = card.dataset.topic;
    card.classList.toggle('selected', selectedTopics.has(topicId));
  });

  // Show/hide custom input
  const customRow = document.getElementById('custom-input-row');
  customRow.style.display = selectedTopics.has('custom') ? 'block' : 'none';

  // Enable/disable generate button
  const btn = document.getElementById('generate-btn');
  const hasCustom = selectedTopics.has('custom');
  const customInput = document.getElementById('custom-query-input').value.trim();
  btn.disabled = selectedTopics.size === 0 || (hasCustom && selectedTopics.size === 1 && !customInput);
}

// --- Article stepper ---
function initStepper() {
  const minus = document.getElementById('stepper-minus');
  const plus = document.getElementById('stepper-plus');
  const display = document.getElementById('stepper-value');

  minus.addEventListener('click', () => {
    if (articleCount > 1) {
      articleCount--;
      display.textContent = articleCount;
    }
  });
  plus.addEventListener('click', () => {
    if (articleCount < 15) {
      articleCount++;
      display.textContent = articleCount;
    }
  });
}

// --- Generate podcast ---
async function generatePodcast() {
  const topics = Array.from(selectedTopics);
  const customQuery = selectedTopics.has('custom')
    ? document.getElementById('custom-query-input').value.trim()
    : null;

  showView('generating');
  document.getElementById('generating-status').textContent = 'Fetching articles...';

  try {
    const res = await fetch('/api/trigger', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': TRIGGER_API_KEY,
      },
      body: JSON.stringify({ topics, customQuery, articleCount }),
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to start generation');
    }

    const { id } = await res.json();
    currentPodcast = { id };
    startPolling(id);
  } catch (err) {
    alert(err.message);
    showView('picker');
  }
}

// --- Polling ---
function startPolling(podcastId) {
  pollInterval = setInterval(async () => {
    try {
      const res = await fetch(`/api/status/${podcastId}`);
      const data = await res.json();

      if (data.status === 'ready') {
        clearInterval(pollInterval);
        pollInterval = null;
        currentPodcast = data;
        showPlayer(data);
      } else if (data.status === 'failed') {
        clearInterval(pollInterval);
        pollInterval = null;
        document.getElementById('generating-status').textContent = 'Generation failed';
        document.querySelector('.generating-sub').textContent = data.error_message || 'Unknown error';
      } else {
        // Update status text based on progress
        const statusText = document.getElementById('generating-status');
        if (data.articles && data.articles.length > 0) {
          statusText.textContent = 'Generating audio...';
        } else {
          statusText.textContent = 'Creating podcast...';
        }
      }
    } catch (err) {
      // Network error, keep polling
    }
  }, 5000);
}

function stopPolling() {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
}

// --- Audio Player ---
function showPlayer(podcast) {
  showView('player');
  const audio = document.getElementById('audio-element');
  audio.src = podcast.audio_url;

  document.getElementById('player-date').textContent = formatDate(podcast.created_at);
  document.getElementById('player-topics').innerHTML = (podcast.topics || [])
    .map(t => `<span class="tag">${t}</span>`).join('');

  // Sources
  const sourcesList = document.getElementById('sources-list');
  sourcesList.innerHTML = (podcast.articles || []).map(a => `
    <a class="source-item" href="${a.url}" target="_blank" rel="noopener">
      <span class="source-badge">${a.source || 'Web'}</span>
      <span class="source-title">${a.title}</span>
    </a>
  `).join('');

  initAudioControls(audio);
}

function initAudioControls(audio) {
  const playBtn = document.getElementById('play-btn');
  const progressContainer = document.getElementById('progress-container');
  const progressBar = document.getElementById('progress-bar');
  const timeCurrent = document.getElementById('time-current');
  const timeTotal = document.getElementById('time-total');

  // Reset state
  playBtn.textContent = '▶';
  progressBar.style.width = '0%';
  timeCurrent.textContent = '0:00';
  timeTotal.textContent = '0:00';

  playBtn.onclick = () => {
    if (audio.paused) {
      audio.play();
      playBtn.textContent = '⏸';
    } else {
      audio.pause();
      playBtn.textContent = '▶';
    }
  };

  audio.onloadedmetadata = () => {
    timeTotal.textContent = formatTime(audio.duration);
  };
  audio.ontimeupdate = () => {
    if (audio.duration) {
      progressBar.style.width = (audio.currentTime / audio.duration * 100) + '%';
      timeCurrent.textContent = formatTime(audio.currentTime);
    }
  };
  audio.onended = () => {
    playBtn.textContent = '▶';
  };

  // Progress bar seeking
  progressContainer.onclick = (e) => {
    const rect = progressContainer.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    audio.currentTime = pct * audio.duration;
  };

  // Skip buttons
  document.getElementById('skip-back').onclick = () => {
    audio.currentTime = Math.max(0, audio.currentTime - 15);
  };
  document.getElementById('skip-forward').onclick = () => {
    audio.currentTime = Math.min(audio.duration, audio.currentTime + 15);
  };

  // Speed controls
  document.querySelectorAll('.speed-btn').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('.speed-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      audio.playbackRate = parseFloat(btn.dataset.speed);
    };
  });
}

// --- History ---
async function loadHistory() {
  showView('history');
  const list = document.getElementById('history-list');
  list.innerHTML = '<p style="text-align:center;color:var(--text-muted)">Loading...</p>';

  try {
    const res = await fetch('/api/podcasts');
    const data = await res.json();
    const podcasts = data.podcasts || [];

    if (podcasts.length === 0) {
      list.innerHTML = '<p style="text-align:center;color:var(--text-muted);padding:40px 0">No podcasts yet</p>';
      return;
    }

    const today = new Date().toDateString();
    list.innerHTML = podcasts.map(p => {
      const isToday = new Date(p.created_at).toDateString() === today;
      const duration = p.duration_seconds ? formatTime(p.duration_seconds) : '—';
      return `
        <div class="history-item ${isToday ? 'today' : ''}" data-id="${p.id}" role="button" tabindex="0">
          <div class="history-date">${formatDate(p.created_at)}</div>
          <div class="history-tags">
            ${(p.topics || []).map(t => `<span class="tag">${t}</span>`).join('')}
          </div>
          <div class="history-meta">${p.article_count} articles · ${duration} · ${p.status}</div>
        </div>
      `;
    }).join('');

    list.addEventListener('click', (e) => {
      const item = e.target.closest('.history-item');
      if (!item) return;
      const podcast = podcasts.find(p => p.id === item.dataset.id);
      if (podcast && podcast.status === 'ready') {
        showPlayer(podcast);
      }
    });
  } catch (err) {
    list.innerHTML = '<p style="text-align:center;color:var(--text-muted)">Failed to load history</p>';
  }
}

// --- Init ---
function init() {
  // Set today's date
  document.getElementById('today-date').textContent = formatDate(new Date());

  renderTopicCards();
  initStepper();

  // Custom query input change
  document.getElementById('custom-query-input').addEventListener('input', updateTopicUI);

  // Generate button
  document.getElementById('generate-btn').addEventListener('click', generatePodcast);
  document.getElementById('generate-btn').disabled = true;

  // Cancel button
  document.getElementById('cancel-btn').addEventListener('click', () => {
    stopPolling();
    showView('picker');
  });

  // Navigation
  document.getElementById('show-history').addEventListener('click', (e) => {
    e.preventDefault();
    loadHistory();
  });
  document.getElementById('back-to-picker').addEventListener('click', (e) => {
    e.preventDefault();
    const audio = document.getElementById('audio-element');
    audio.pause();
    showView('picker');
  });
  document.getElementById('back-from-history').addEventListener('click', (e) => {
    e.preventDefault();
    showView('picker');
  });
}

document.addEventListener('DOMContentLoaded', init);
```

- [ ] **Step 2: Test the frontend locally**

Run: `npx serve . -l 3000` and verify in browser:
- Topic cards render in 2-column grid with Custom spanning full width
- Tapping a card toggles purple border + badge
- Custom card shows text input when selected
- Stepper increments/decrements between 1 and 15
- Generate button is disabled with no selection, enabled with selection
- View switching works (history link, back links)
- Cancel button returns to picker

- [ ] **Step 3: Commit**

```bash
git add app.js
git commit -m "feat: add frontend JS with topic picker, audio player, and history views"
```

---

## Chunk 2: Vercel API Routes

### Task 5: API route — GET /api/podcasts

**Files:**
- Create: `api/podcasts.js`

- [ ] **Step 1: Create the podcasts list endpoint**

```js
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const { data, error } = await supabase
      .from('podcasts')
      .select('id, topics, article_count, articles, audio_url, duration_seconds, status, created_at')
      .gte('created_at', sevenDaysAgo.toISOString())
      .order('created_at', { ascending: false });

    if (error) throw error;

    return res.status(200).json({ podcasts: data });
  } catch (err) {
    console.error('Error fetching podcasts:', err);
    return res.status(500).json({ error: 'Failed to fetch podcasts' });
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add api/podcasts.js
git commit -m "feat: add GET /api/podcasts endpoint"
```

---

### Task 6: API route — GET /api/status/[id]

**Files:**
- Create: `api/status/[id].js`

- [ ] **Step 1: Create the status polling endpoint**

```js
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { id } = req.query;

  if (!id) {
    return res.status(400).json({ error: 'Missing podcast ID' });
  }

  try {
    const { data, error } = await supabase
      .from('podcasts')
      .select('id, status, audio_url, duration_seconds, error_message, topics, articles, article_count, created_at')
      .eq('id', id)
      .single();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Podcast not found' });

    return res.status(200).json(data);
  } catch (err) {
    console.error('Error fetching podcast status:', err);
    return res.status(500).json({ error: 'Failed to fetch status' });
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add api/status/
git commit -m "feat: add GET /api/status/:id endpoint"
```

---

### Task 7: API route — POST /api/trigger

**Files:**
- Create: `api/trigger.js`

- [ ] **Step 1: Create the trigger endpoint with auth, rate limiting, and workflow dispatch**

```js
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Auth check
  const apiKey = req.headers['x-api-key'];
  if (!apiKey || apiKey !== process.env.TRIGGER_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { topics, customQuery, articleCount } = req.body;

  if (!topics || !Array.isArray(topics) || topics.length === 0) {
    return res.status(400).json({ error: 'At least one topic is required' });
  }

  try {
    // Rate limit: check for active generation
    const { data: active } = await supabase
      .from('podcasts')
      .select('id')
      .eq('status', 'generating')
      .limit(1);

    if (active && active.length > 0) {
      return res.status(429).json({ error: 'A podcast is already being generated. Please wait.' });
    }

    // Rate limit: check for recent generation (last 10 minutes)
    const tenMinutesAgo = new Date();
    tenMinutesAgo.setMinutes(tenMinutesAgo.getMinutes() - 10);

    const { data: recent } = await supabase
      .from('podcasts')
      .select('id')
      .gte('created_at', tenMinutesAgo.toISOString())
      .limit(1);

    if (recent && recent.length > 0) {
      return res.status(429).json({ error: 'Please wait at least 10 minutes between generations.' });
    }

    // Create podcast row
    const { data: podcast, error: insertError } = await supabase
      .from('podcasts')
      .insert({
        topics,
        custom_query: customQuery || null,
        article_count: articleCount || 5,
        status: 'generating',
      })
      .select('id')
      .single();

    if (insertError) throw insertError;

    // Fire GitHub Actions workflow
    const [owner, repo] = (process.env.GITHUB_REPO || '').split('/');
    const ghRes = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/actions/workflows/generate-podcast.yml/dispatches`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
          Accept: 'application/vnd.github.v3+json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ref: 'main',
          inputs: {
            podcastId: podcast.id,
            topics: JSON.stringify(topics),
            customQuery: customQuery || '',
            articleCount: String(articleCount || 5),
          },
        }),
      }
    );

    if (!ghRes.ok) {
      const ghError = await ghRes.text();
      console.error('GitHub Actions dispatch failed:', ghError);
      await supabase.from('podcasts').update({
        status: 'failed',
        error_message: 'Failed to start generation pipeline',
      }).eq('id', podcast.id);
      return res.status(500).json({ error: 'Failed to start generation' });
    }

    return res.status(200).json({ id: podcast.id });
  } catch (err) {
    console.error('Trigger error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add api/trigger.js
git commit -m "feat: add POST /api/trigger with auth, rate limiting, and GitHub Actions dispatch"
```

---

## Chunk 3: Generation Pipeline Scripts

### Task 8: RSS feed configuration and fetching

**Files:**
- Create: `scripts/rss-feeds.js`

- [ ] **Step 1: Create RSS feed config with fetch logic**

```js
import Parser from 'rss-parser';

const parser = new Parser({
  timeout: 10000,
  headers: { 'User-Agent': 'NewsPodcastBot/1.0' },
});

export const RSS_FEEDS = {
  ai: {
    name: 'AI',
    defaultArticles: 8,
    feeds: [
      'https://openai.com/blog/rss.xml',
      'https://www.anthropic.com/rss.xml',
      'https://blog.google/technology/ai/rss/',
      'https://deepmind.google/blog/rss.xml',
      'https://techcrunch.com/category/artificial-intelligence/feed/',
      'https://www.theverge.com/rss/ai-artificial-intelligence/index.xml',
      'https://www.technologyreview.com/feed/',
    ],
  },
  tech: {
    name: 'Tech',
    defaultArticles: 5,
    feeds: [
      'https://techcrunch.com/feed/',
      'https://www.theverge.com/rss/index.xml',
      'https://feeds.arstechnica.com/arstechnica/index',
      'https://www.wired.com/feed/rss',
    ],
  },
  gadgets: {
    name: 'Gadgets',
    defaultArticles: 5,
    feeds: [
      'https://www.theverge.com/rss/reviews/index.xml',
      'https://www.engadget.com/rss.xml',
      'https://www.cnet.com/rss/news/',
    ],
  },
  world: {
    name: 'World',
    defaultArticles: 5,
    feeds: [
      'https://feeds.reuters.com/reuters/topNews',
      'https://rss.app/feeds/v1.1/apnews-world.xml',
      'https://feeds.bbci.co.uk/news/world/rss.xml',
    ],
  },
  'us-news': {
    name: 'US News',
    defaultArticles: 5,
    feeds: [
      'https://rss.app/feeds/v1.1/apnews-us.xml',
      'https://feeds.npr.org/1001/rss.xml',
      'https://www.pbs.org/newshour/feeds/rss/headlines',
    ],
  },
  local: {
    name: 'Local News',
    defaultArticles: 5,
    feeds: [], // Configured per deployment via LOCAL_NEWS_LOCATION
  },
};

/**
 * Fetch articles from RSS feeds for a given topic.
 * Returns array of { title, source, url, pubDate }
 */
export async function fetchArticlesForTopic(topicId, maxArticles) {
  const topicConfig = RSS_FEEDS[topicId];
  if (!topicConfig || topicConfig.feeds.length === 0) {
    console.warn(`No feeds configured for topic: ${topicId}`);
    return [];
  }

  const limit = maxArticles || topicConfig.defaultArticles;
  const now = new Date();
  const threeDaysAgo = new Date(now - 3 * 24 * 60 * 60 * 1000);
  const oneWeekAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);
  const oneMonthAgo = new Date(now - 30 * 24 * 60 * 60 * 1000);

  // Fetch all feeds in parallel
  const feedResults = await Promise.allSettled(
    topicConfig.feeds.map(async (feedUrl) => {
      try {
        const feed = await parser.parseURL(feedUrl);
        return (feed.items || []).map(item => ({
          title: item.title || 'Untitled',
          source: feed.title || new URL(feedUrl).hostname,
          url: item.link || item.guid,
          pubDate: item.pubDate ? new Date(item.pubDate) : now,
        }));
      } catch (err) {
        console.warn(`Failed to fetch feed ${feedUrl}:`, err.message);
        return [];
      }
    })
  );

  // Flatten all articles
  let articles = feedResults
    .filter(r => r.status === 'fulfilled')
    .flatMap(r => r.value)
    .filter(a => a.url);

  // Progressive time filtering: try 3 days, then 1 week, then 1 month
  let filtered = articles.filter(a => a.pubDate >= threeDaysAgo);
  if (filtered.length === 0) {
    filtered = articles.filter(a => a.pubDate >= oneWeekAgo);
  }
  if (filtered.length === 0) {
    filtered = articles.filter(a => a.pubDate >= oneMonthAgo);
  }
  if (filtered.length === 0) {
    filtered = articles; // Use whatever we have
  }

  // Sort by date (newest first), dedupe by URL, limit
  const seen = new Set();
  return filtered
    .sort((a, b) => b.pubDate - a.pubDate)
    .filter(a => {
      if (seen.has(a.url)) return false;
      seen.add(a.url);
      return true;
    })
    .slice(0, limit)
    .map(({ title, source, url }) => ({ title, source, url }));
}
```

- [ ] **Step 2: Test RSS fetching locally**

Run: `node -e "import('./scripts/rss-feeds.js').then(m => m.fetchArticlesForTopic('ai', 3).then(a => console.log(JSON.stringify(a, null, 2))))"`

Expected: JSON array with article objects containing title, source, url.

- [ ] **Step 3: Commit**

```bash
git add scripts/rss-feeds.js
git commit -m "feat: add RSS feed config and fetch logic with progressive time fallback"
```

---

### Task 9: Custom query cleanup with Claude Haiku

**Files:**
- Create: `scripts/custom-query.js`

- [ ] **Step 1: Create Haiku query cleanup and News API search module**

```js
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic();

/**
 * Clean a messy user query into two search-ready queries using Claude Haiku.
 * Returns { specific: string, broad: string }
 */
export async function cleanCustomQuery(rawQuery) {
  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 200,
    messages: [
      {
        role: 'user',
        content: `You are a search query optimizer. The user typed a messy search query for finding recent news articles. Fix typos, extract intent, and return two clean search queries.

User input: "${rawQuery}"

Respond with ONLY valid JSON (no markdown):
{"specific": "exact focused query", "broad": "broader fallback query"}`,
      },
    ],
  });

  const text = response.content[0].text.trim();
  try {
    return JSON.parse(text);
  } catch {
    // Fallback: use the raw query
    return { specific: rawQuery, broad: rawQuery };
  }
}

/**
 * Search News API with cleaned queries and progressive time fallback.
 * Returns array of { title, source, url }
 */
export async function searchNewsAPI(queries, maxArticles = 5) {
  const apiKey = process.env.NEWS_API_KEY;
  if (!apiKey) {
    console.warn('NEWS_API_KEY not set, skipping custom topic search');
    return [];
  }

  const now = new Date();
  const timeWindows = [
    new Date(now - 1 * 24 * 60 * 60 * 1000), // yesterday
    new Date(now - 7 * 24 * 60 * 60 * 1000), // last week
    new Date(now - 30 * 24 * 60 * 60 * 1000), // last month
  ];

  for (const query of [queries.specific, queries.broad]) {
    for (const fromDate of timeWindows) {
      const params = new URLSearchParams({
        q: query,
        from: fromDate.toISOString().split('T')[0],
        sortBy: 'publishedAt',
        pageSize: String(maxArticles),
        apiKey,
      });

      try {
        const res = await fetch(`https://newsapi.org/v2/everything?${params}`);
        const data = await res.json();

        if (data.articles && data.articles.length > 0) {
          return data.articles.map(a => ({
            title: a.title,
            source: a.source?.name || 'News',
            url: a.url,
          }));
        }
      } catch (err) {
        console.warn(`News API search failed for "${query}":`, err.message);
      }
    }
  }

  return [];
}
```

- [ ] **Step 2: Commit**

```bash
git add scripts/custom-query.js
git commit -m "feat: add Claude Haiku query cleanup and News API search with fallbacks"
```

---

### Task 10: NotebookLM operations module

**Files:**
- Create: `scripts/notebooklm.js`

- [ ] **Step 1: Create NotebookLM wrapper using nlm CLI**

```js
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const exec = promisify(execFile);

/**
 * Run an nlm CLI command and return parsed JSON output.
 */
async function nlm(args) {
  try {
    const { stdout } = await exec('npx', ['nlm', ...args], {
      timeout: 120000,
      env: { ...process.env },
    });
    try {
      return JSON.parse(stdout.trim());
    } catch {
      return stdout.trim();
    }
  } catch (err) {
    console.error(`nlm ${args.join(' ')} failed:`, err.stderr || err.message);
    throw new Error(`nlm command failed: ${args[0]} — ${err.message}`);
  }
}

/**
 * Refresh NotebookLM auth token (for CI/GitHub Actions).
 */
export async function refreshAuth() {
  console.log('Refreshing NotebookLM auth...');
  await nlm(['login', 'refresh']);
}

/**
 * Create a new notebook with the given title.
 * Returns the notebook ID.
 */
export async function createNotebook(title) {
  console.log(`Creating notebook: ${title}`);
  const result = await nlm(['notebook', 'create', '--title', title, '--json']);
  return result.id || result.notebookId || result;
}

/**
 * Add a URL source to a notebook.
 */
export async function addSource(notebookId, url) {
  console.log(`Adding source: ${url}`);
  await nlm(['source', 'add', '--notebook', notebookId, '--type', 'url', '--url', url, '--json']);
}

/**
 * Create an audio artifact and poll until complete.
 * Returns the artifact/studio ID.
 */
export async function generateAudio(notebookId) {
  console.log('Starting audio generation...');
  const result = await nlm(['studio', 'create', '--notebook', notebookId, '--type', 'audio', '--json']);
  const studioId = result.id || result.studioId || result;

  // Poll for completion
  let attempts = 0;
  const maxAttempts = 40; // 10 minutes at 15s intervals
  while (attempts < maxAttempts) {
    await new Promise(resolve => setTimeout(resolve, 15000));
    attempts++;

    const status = await nlm(['studio', 'status', '--notebook', notebookId, '--json']);
    console.log(`Audio generation status (attempt ${attempts}): ${status.status || JSON.stringify(status)}`);

    if (status.status === 'completed' || status.status === 'ready') {
      return studioId;
    }
    if (status.status === 'failed' || status.status === 'error') {
      throw new Error(`Audio generation failed: ${status.error || 'Unknown error'}`);
    }
  }

  throw new Error('Audio generation timed out after 10 minutes');
}

/**
 * Download the audio artifact to a temp file.
 * Returns the local file path.
 */
export async function downloadAudio(notebookId) {
  const outputPath = path.join('/tmp', `podcast-${Date.now()}.mp3`);
  console.log(`Downloading audio to ${outputPath}...`);
  await nlm(['studio', 'download', '--notebook', notebookId, '--type', 'audio', '--output', outputPath]);
  return outputPath;
}

/**
 * Delete a notebook.
 */
export async function deleteNotebook(notebookId) {
  console.log(`Deleting notebook: ${notebookId}`);
  try {
    await nlm(['notebook', 'delete', '--id', notebookId, '--confirm', '--json']);
  } catch (err) {
    console.warn(`Failed to delete notebook ${notebookId}:`, err.message);
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add scripts/notebooklm.js
git commit -m "feat: add NotebookLM operations module wrapping nlm CLI"
```

---

### Task 11: Main generation pipeline script

**Files:**
- Create: `scripts/generate.js`

- [ ] **Step 1: Create the main pipeline orchestrator**

```js
import { createClient } from '@supabase/supabase-js';
import { readFile } from 'node:fs/promises';
import { fetchArticlesForTopic } from './rss-feeds.js';
import { cleanCustomQuery, searchNewsAPI } from './custom-query.js';
import { refreshAuth, createNotebook, addSource, generateAudio, downloadAudio, deleteNotebook } from './notebooklm.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Default topics for cron trigger
const DEFAULT_TOPICS = ['ai'];
const DEFAULT_ARTICLE_COUNT = 8;

async function updatePodcast(podcastId, updates) {
  const { error } = await supabase.from('podcasts').update(updates).eq('id', podcastId);
  if (error) console.error('Failed to update podcast:', error);
}

async function main() {
  // Parse inputs from GitHub Actions
  const podcastId = process.env.INPUT_PODCAST_ID || null;
  const topics = process.env.INPUT_TOPICS ? JSON.parse(process.env.INPUT_TOPICS) : DEFAULT_TOPICS;
  const customQuery = process.env.INPUT_CUSTOM_QUERY || null;
  const articleCount = parseInt(process.env.INPUT_ARTICLE_COUNT || String(DEFAULT_ARTICLE_COUNT), 10);

  let id = podcastId;

  try {
    // If no podcast ID (cron trigger), create a row
    if (!id) {
      const { data, error } = await supabase
        .from('podcasts')
        .insert({ topics, status: 'generating', article_count: articleCount })
        .select('id')
        .single();
      if (error) throw error;
      id = data.id;
    }

    console.log(`Pipeline started for podcast ${id}, topics: ${topics.join(', ')}`);

    // Step 1: Refresh NotebookLM auth
    await refreshAuth();

    // Step 2: Fetch articles for each topic
    let allArticles = [];

    for (const topic of topics) {
      if (topic === 'custom' && customQuery) {
        console.log(`Cleaning custom query: "${customQuery}"`);
        const cleaned = await cleanCustomQuery(customQuery);
        console.log(`Cleaned queries: ${JSON.stringify(cleaned)}`);
        const customArticles = await searchNewsAPI(cleaned, articleCount);
        allArticles.push(...customArticles);
      } else if (topic !== 'custom') {
        const topicArticles = await fetchArticlesForTopic(topic, articleCount);
        allArticles.push(...topicArticles);
      }
    }

    // Deduplicate by URL
    const seen = new Set();
    allArticles = allArticles.filter(a => {
      if (seen.has(a.url)) return false;
      seen.add(a.url);
      return true;
    });

    if (allArticles.length === 0) {
      throw new Error('No articles found for the selected topics');
    }

    console.log(`Collected ${allArticles.length} unique articles`);

    // Step 3: Update Supabase with articles
    await updatePodcast(id, {
      articles: allArticles,
      article_count: allArticles.length,
    });

    // Step 4: Create NotebookLM notebook
    const today = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const notebookTitle = `News Podcast — ${today}`;
    const notebookId = await createNotebook(notebookTitle);
    await updatePodcast(id, { notebook_id: notebookId });

    // Step 5: Add sources (sequentially to avoid rate limits)
    for (const article of allArticles) {
      try {
        await addSource(notebookId, article.url);
      } catch (err) {
        console.warn(`Failed to add source ${article.url}:`, err.message);
      }
    }

    // Step 6: Generate audio
    await generateAudio(notebookId);

    // Step 7: Download audio and upload to Supabase Storage
    const localPath = await downloadAudio(notebookId);
    const audioBuffer = await readFile(localPath);
    const storagePath = `${id}.mp3`;

    const { error: uploadError } = await supabase.storage
      .from('podcast-audio')
      .upload(storagePath, audioBuffer, {
        contentType: 'audio/mpeg',
        upsert: true,
      });

    if (uploadError) throw new Error(`Storage upload failed: ${uploadError.message}`);

    const { data: urlData } = supabase.storage
      .from('podcast-audio')
      .getPublicUrl(storagePath);

    // Step 8: Mark as ready
    await updatePodcast(id, {
      audio_url: urlData.publicUrl,
      status: 'ready',
    });

    console.log(`Podcast ${id} is ready: ${urlData.publicUrl}`);

    // Step 9: Cleanup old podcasts
    await cleanupOldPodcasts();

    console.log('Pipeline complete.');
  } catch (err) {
    console.error('Pipeline failed:', err);
    if (id) {
      await updatePodcast(id, {
        status: 'failed',
        error_message: err.message,
      });
    }
    process.exit(1);
  }
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
    // Delete audio from storage
    try {
      await supabase.storage.from('podcast-audio').remove([`${podcast.id}.mp3`]);
    } catch (err) {
      console.warn(`Failed to delete audio for ${podcast.id}:`, err.message);
    }

    // Delete NotebookLM notebook
    if (podcast.notebook_id) {
      await deleteNotebook(podcast.notebook_id);
    }

    // Delete Supabase row
    await supabase.from('podcasts').delete().eq('id', podcast.id);
  }
}

main();
```

- [ ] **Step 2: Commit**

```bash
git add scripts/generate.js
git commit -m "feat: add main generation pipeline with RSS, NotebookLM, and Supabase integration"
```

---

## Chunk 4: GitHub Actions Workflow + Supabase Setup

### Task 12: GitHub Actions workflow

**Files:**
- Create: `.github/workflows/generate-podcast.yml`

- [ ] **Step 1: Create the workflow file**

```yaml
name: Generate Podcast

on:
  schedule:
    - cron: '0 6 * * *'
  workflow_dispatch:
    inputs:
      podcastId:
        description: 'Podcast row ID in Supabase'
        required: false
      topics:
        description: 'JSON array of topic IDs'
        required: false
        default: '["ai"]'
      customQuery:
        description: 'Raw custom topic search query'
        required: false
      articleCount:
        description: 'Number of articles per topic'
        required: false
        default: '5'

jobs:
  generate:
    runs-on: ubuntu-latest
    timeout-minutes: 15

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Run generation pipeline
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_KEY: ${{ secrets.SUPABASE_SERVICE_KEY }}
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          NEWS_API_KEY: ${{ secrets.NEWS_API_KEY }}
          NLM_REFRESH_TOKEN: ${{ secrets.NLM_REFRESH_TOKEN }}
          LOCAL_NEWS_LOCATION: ${{ secrets.LOCAL_NEWS_LOCATION }}
          INPUT_PODCAST_ID: ${{ github.event.inputs.podcastId }}
          INPUT_TOPICS: ${{ github.event.inputs.topics }}
          INPUT_CUSTOM_QUERY: ${{ github.event.inputs.customQuery }}
          INPUT_ARTICLE_COUNT: ${{ github.event.inputs.articleCount }}
        run: node scripts/generate.js
```

- [ ] **Step 2: Commit**

```bash
git add .github/
git commit -m "feat: add GitHub Actions workflow for scheduled and on-demand podcast generation"
```

---

### Task 13: Supabase setup SQL

**Files:**
- Create: `docs/supabase-setup.sql`

- [ ] **Step 1: Create Supabase schema and RLS setup**

```sql
-- Create podcasts table
CREATE TABLE IF NOT EXISTS podcasts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  topics text[] NOT NULL DEFAULT '{}',
  custom_query text,
  article_count int DEFAULT 0,
  articles jsonb DEFAULT '[]'::jsonb,
  audio_url text,
  notebook_id text,
  duration_seconds int,
  status text NOT NULL DEFAULT 'generating' CHECK (status IN ('generating', 'ready', 'failed')),
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- RLS: Enable row-level security
ALTER TABLE podcasts ENABLE ROW LEVEL SECURITY;

-- Policy: Anyone can read podcasts (anon key)
CREATE POLICY "Public read access" ON podcasts
  FOR SELECT USING (true);

-- Policy: Service role can insert/update/delete
CREATE POLICY "Service role full access" ON podcasts
  FOR ALL USING (auth.role() = 'service_role');

-- Create index for date-based queries
CREATE INDEX idx_podcasts_created_at ON podcasts (created_at DESC);

-- Note: Create storage bucket 'podcast-audio' (public) via Supabase dashboard
-- Settings > Storage > New bucket > name: podcast-audio, Public: ON
```

- [ ] **Step 2: Commit**

```bash
git add docs/supabase-setup.sql
git commit -m "docs: add Supabase schema and RLS setup SQL"
```

---

### Task 14: Final verification

- [ ] **Step 1: Verify all files exist and match the planned structure**

Run: `find . -not -path './.git/*' -not -path './node_modules/*' -not -name '.DS_Store' -type f | sort`

Expected:
```
./.env.example
./.github/workflows/generate-podcast.yml
./.gitignore
./api/podcasts.js
./api/status/[id].js
./api/trigger.js
./app.js
./docs/supabase-setup.sql
./docs/superpowers/plans/2026-03-15-news-podcast-app.md
./docs/superpowers/specs/2026-03-15-news-podcast-app-design.md
./index.html
./package.json
./scripts/custom-query.js
./scripts/generate.js
./scripts/notebooklm.js
./scripts/rss-feeds.js
./styles.css
./vercel.json
```

- [ ] **Step 2: Verify no JS syntax errors**

Run: `node --check app.js && node --check api/podcasts.js && node --check api/trigger.js && echo "All OK"`

- [ ] **Step 3: Final commit if any fixes needed**

---

## Deployment Steps (Manual)

After all code is committed and pushed:

1. **Create GitHub repo** and push code
2. **Set up Supabase**: Run `docs/supabase-setup.sql` in SQL Editor, create `podcast-audio` storage bucket (public)
3. **Update `app.js` config**: Replace the empty `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `TRIGGER_API_KEY` constants with your actual values before deploying. These are public-facing values (anon key is safe to embed).
4. **Deploy to Vercel**: Link repo, set all env vars from `.env.example`
5. **Set GitHub secrets**: All env vars needed by the workflow
5. **Run `nlm login`** locally to get refresh token, store as `NLM_REFRESH_TOKEN` secret
6. **Test manually**: Trigger a `workflow_dispatch` from GitHub Actions UI
7. **Verify**: Check Supabase for the podcast row, confirm audio plays in the frontend
