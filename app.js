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

let selectedTopics = new Set();
let articleCount = 5;
let currentPodcast = null;
let pollInterval = null;

const views = {
  picker: document.getElementById('view-picker'),
  generating: document.getElementById('view-generating'),
  player: document.getElementById('view-player'),
  history: document.getElementById('view-history'),
};

function showView(name) {
  Object.values(views).forEach(v => v.classList.remove('active'));
  views[name].classList.add('active');
}

function formatDate(date) {
  return new Date(date).toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });
}
function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

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
    toggleTopic(card.dataset.topic);
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
    card.classList.toggle('selected', selectedTopics.has(card.dataset.topic));
  });
  const customRow = document.getElementById('custom-input-row');
  customRow.style.display = selectedTopics.has('custom') ? 'block' : 'none';
  const btn = document.getElementById('generate-btn');
  const hasCustom = selectedTopics.has('custom');
  const customInput = document.getElementById('custom-query-input').value.trim();
  btn.disabled = selectedTopics.size === 0 || (hasCustom && selectedTopics.size === 1 && !customInput);
}

function initStepper() {
  const minus = document.getElementById('stepper-minus');
  const plus = document.getElementById('stepper-plus');
  const display = document.getElementById('stepper-value');
  minus.addEventListener('click', () => { if (articleCount > 1) { articleCount--; display.textContent = articleCount; } });
  plus.addEventListener('click', () => { if (articleCount < 15) { articleCount++; display.textContent = articleCount; } });
}

async function generatePodcast() {
  const topics = Array.from(selectedTopics);
  const customQuery = selectedTopics.has('custom') ? document.getElementById('custom-query-input').value.trim() : null;
  showView('generating');
  document.getElementById('generating-status').textContent = 'Fetching articles...';
  try {
    const res = await fetch('/api/trigger', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': TRIGGER_API_KEY },
      body: JSON.stringify({ topics, customQuery, articleCount }),
    });
    if (!res.ok) { const err = await res.json(); throw new Error(err.error || 'Failed to start generation'); }
    const { id } = await res.json();
    currentPodcast = { id };
    startPolling(id);
  } catch (err) { alert(err.message); showView('picker'); }
}

function startPolling(podcastId) {
  pollInterval = setInterval(async () => {
    try {
      const res = await fetch(`/api/status/${podcastId}`);
      const data = await res.json();
      if (data.status === 'ready') { clearInterval(pollInterval); pollInterval = null; currentPodcast = data; showPlayer(data); }
      else if (data.status === 'failed') {
        clearInterval(pollInterval); pollInterval = null;
        document.getElementById('generating-status').textContent = 'Generation failed';
        document.querySelector('.generating-sub').textContent = data.error_message || 'Unknown error';
      } else {
        const statusText = document.getElementById('generating-status');
        statusText.textContent = (data.articles && data.articles.length > 0) ? 'Generating audio...' : 'Creating podcast...';
      }
    } catch (err) { /* network error, keep polling */ }
  }, 5000);
}

function stopPolling() { if (pollInterval) { clearInterval(pollInterval); pollInterval = null; } }

function showPlayer(podcast) {
  showView('player');
  const audio = document.getElementById('audio-element');
  audio.src = podcast.audio_url;
  document.getElementById('player-date').textContent = formatDate(podcast.created_at);
  document.getElementById('player-topics').innerHTML = (podcast.topics || []).map(t => `<span class="tag">${t}</span>`).join('');
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
  playBtn.textContent = '▶'; progressBar.style.width = '0%';
  timeCurrent.textContent = '0:00'; timeTotal.textContent = '0:00';

  playBtn.onclick = () => {
    if (audio.paused) { audio.play(); playBtn.textContent = '⏸'; }
    else { audio.pause(); playBtn.textContent = '▶'; }
  };
  audio.onloadedmetadata = () => { timeTotal.textContent = formatTime(audio.duration); };
  audio.ontimeupdate = () => {
    if (audio.duration) {
      progressBar.style.width = (audio.currentTime / audio.duration * 100) + '%';
      timeCurrent.textContent = formatTime(audio.currentTime);
    }
  };
  audio.onended = () => { playBtn.textContent = '▶'; };
  progressContainer.onclick = (e) => {
    const rect = progressContainer.getBoundingClientRect();
    audio.currentTime = ((e.clientX - rect.left) / rect.width) * audio.duration;
  };
  document.getElementById('skip-back').onclick = () => { audio.currentTime = Math.max(0, audio.currentTime - 15); };
  document.getElementById('skip-forward').onclick = () => { audio.currentTime = Math.min(audio.duration, audio.currentTime + 15); };
  document.querySelectorAll('.speed-btn').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('.speed-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      audio.playbackRate = parseFloat(btn.dataset.speed);
    };
  });
}

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
          <div class="history-tags">${(p.topics || []).map(t => `<span class="tag">${t}</span>`).join('')}</div>
          <div class="history-meta">${p.article_count} articles · ${duration} · ${p.status}</div>
        </div>`;
    }).join('');
    list.addEventListener('click', (e) => {
      const item = e.target.closest('.history-item');
      if (!item) return;
      const podcast = podcasts.find(p => p.id === item.dataset.id);
      if (podcast && podcast.status === 'ready') showPlayer(podcast);
    });
  } catch (err) {
    list.innerHTML = '<p style="text-align:center;color:var(--text-muted)">Failed to load history</p>';
  }
}

function init() {
  document.getElementById('today-date').textContent = formatDate(new Date());
  renderTopicCards();
  initStepper();
  document.getElementById('custom-query-input').addEventListener('input', updateTopicUI);
  document.getElementById('generate-btn').addEventListener('click', generatePodcast);
  document.getElementById('generate-btn').disabled = true;
  document.getElementById('cancel-btn').addEventListener('click', () => { stopPolling(); showView('picker'); });
  document.getElementById('show-history').addEventListener('click', (e) => { e.preventDefault(); loadHistory(); });
  document.getElementById('back-to-picker').addEventListener('click', (e) => { e.preventDefault(); document.getElementById('audio-element').pause(); showView('picker'); });
  document.getElementById('back-from-history').addEventListener('click', (e) => { e.preventDefault(); showView('picker'); });
}

document.addEventListener('DOMContentLoaded', init);
