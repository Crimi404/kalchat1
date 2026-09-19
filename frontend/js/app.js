const API = '/api';
let token = localStorage.getItem('kalchat_token');
let me = null;
let socket = null;
let activeConversationId = null;
let typingTimeout = null;

// ---------------- Helpers ----------------
async function api(path, { method = 'GET', body, isForm = false } = {}) {
  const headers = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (!isForm) headers['Content-Type'] = 'application/json';

  const res = await fetch(API + path, {
    method,
    headers,
    body: body ? (isForm ? body : JSON.stringify(body)) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Erreur serveur');
  return data;
}

function initials(name) {
  return (name || '?').slice(0, 2).toUpperCase();
}

function fmtTime(iso) {
  const d = new Date(iso + 'Z');
  return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

// ---------------- Auth ----------------
const authScreen = document.getElementById('auth-screen');
const appEl = document.getElementById('app');

document.querySelectorAll('.auth-tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.auth-tab').forEach((t) => t.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById('login-form').classList.toggle('hidden', tab.dataset.tab !== 'login');
    document.getElementById('register-form').classList.toggle('hidden', tab.dataset.tab !== 'register');
  });
});

document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value;
  try {
    const data = await api('/auth/login', { method: 'POST', body: { username, password } });
    onAuthSuccess(data);
  } catch (err) {
    document.getElementById('login-error').textContent = err.message;
  }
});

document.getElementById('register-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = document.getElementById('register-username').value.trim();
  const password = document.getElementById('register-password').value;
  try {
    const data = await api('/auth/register', { method: 'POST', body: { username, password } });
    onAuthSuccess(data);
  } catch (err) {
    document.getElementById('register-error').textContent = err.message;
  }
});

function onAuthSuccess(data) {
  token = data.token;
  me = data.user;
  localStorage.setItem('kalchat_token', token);
  startApp();
}

document.getElementById('logout-btn').addEventListener('click', () => {
  localStorage.removeItem('kalchat_token');
  location.reload();
});

// ---------------- Démarrage de l'app ----------------
async function startApp() {
  authScreen.classList.add('hidden');
  appEl.classList.remove('hidden');

  if (!me) me = await api('/auth/me');
  document.getElementById('me-username').textContent = me.username;
  document.getElementById('me-avatar').textContent = initials(me.username);

  connectSocket();
  loadConversations();
  loadStories();
  setBottomNavActive('messages');
}

function connectSocket() {
  socket = io({ auth: { token } });

  socket.on('new_message', ({ conversation_id, message }) => {
    if (conversation_id === activeConversationId) {
      renderMessage(message);
      scrollMessagesToBottom();
    }
    loadConversations();
  });

  socket.on('typing', ({ conversation_id, username, is_typing }) => {
    if (conversation_id !== activeConversationId) return;
    document.getElementById('chat-typing').textContent = is_typing ? `${username} écrit...` : '';
  });
}

// ---------------- Conversations ----------------
async function loadConversations() {
  const convs = await api('/chat/conversations');
  const list = document.getElementById('conversations-list');
  list.innerHTML = '';
  convs.forEach((c) => {
    const row = document.createElement('div');
    row.className = 'conversation-row' + (c.id === activeConversationId ? ' active' : '');
    row.innerHTML = `
      <div class="avatar">${initials(c.name)}</div>
      <div class="conv-meta">
        <div class="conv-name">${c.name || 'Conversation'}${c.is_group ? ' 👥' : ''}</div>
        <div class="conv-last">${c.last_message || 'Aucun message pour le moment'}</div>
      </div>`;
    row.addEventListener('click', () => openConversation(c));
    list.appendChild(row);
  });
}

async function openConversation(conv) {
  activeConversationId = conv.id;
  document.getElementById('sidebar').classList.add('mobile-hidden');
  document.getElementById('empty-state').classList.add('hidden');
  document.getElementById('chat-window').classList.remove('hidden');
  document.getElementById('chat-title').textContent = conv.name || 'Conversation';
  document.getElementById('chat-avatar').textContent = initials(conv.name);
  document.getElementById('chat-typing').textContent = '';

  socket.emit('join', conv.id);
  loadConversations();

  const messages = await api(`/chat/conversations/${conv.id}/messages`);
  const box = document.getElementById('messages');
  box.innerHTML = '';
  messages.forEach(renderMessage);
  scrollMessagesToBottom();
}

function renderMessage(m) {
  const box = document.getElementById('messages');
  const div = document.createElement('div');
  const mine = m.sender_id === me.id;
  div.className = 'msg ' + (mine ? 'mine' : 'theirs');
  let html = '';
  if (!mine) html += `<span class="sender">${m.sender_username}</span>`;
  if (m.content) html += m.content.replace(/</g, '&lt;');
  if (m.media_url) html += `<img src="${m.media_url}" alt="média" />`;
  html += `<time>${fmtTime(m.created_at)}</time>`;
  div.innerHTML = html;
  box.appendChild(div);
}

function scrollMessagesToBottom() {
  const box = document.getElementById('messages');
  box.scrollTop = box.scrollHeight;
}

// ---------------- Envoi de message ----------------
document.getElementById('message-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!activeConversationId) return;
  const input = document.getElementById('message-input');
  const fileInput = document.getElementById('message-file');
  const content = input.value.trim();
  let media_url = null;

  if (fileInput.files[0]) {
    media_url = await uploadFile(fileInput.files[0]);
    fileInput.value = '';
  }
  if (!content && !media_url) return;

  await api(`/chat/conversations/${activeConversationId}/messages`, {
    method: 'POST',
    body: { content, media_url },
  });
  input.value = '';
  socket.emit('typing', { conversation_id: activeConversationId, is_typing: false });
});

document.getElementById('message-input').addEventListener('input', () => {
  if (!activeConversationId) return;
  socket.emit('typing', { conversation_id: activeConversationId, is_typing: true });
  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(() => {
    socket.emit('typing', { conversation_id: activeConversationId, is_typing: false });
  }, 1500);
});

async function uploadFile(file) {
  const form = new FormData();
  form.append('file', file);
  const data = await api('/upload', { method: 'POST', body: form, isForm: true });
  return data.url;
}

// ---------------- Recherche d'utilisateurs / démarrer une conv ----------------
const searchInput = document.getElementById('user-search');
const searchResults = document.getElementById('search-results');

searchInput.addEventListener('input', async () => {
  const q = searchInput.value.trim();
  if (!q) { searchResults.classList.add('hidden'); return; }
  const users = await api(`/auth/search?q=${encodeURIComponent(q)}`);
  searchResults.innerHTML = '';
  users.forEach((u) => {
    const row = document.createElement('div');
    row.className = 'search-result-row';
    row.innerHTML = `<div class="avatar small">${initials(u.username)}</div><span>${u.username}</span>`;
    row.addEventListener('click', async () => {
      const conv = await api('/chat/conversations', { method: 'POST', body: { member_ids: [u.id], is_group: false } });
      searchInput.value = '';
      searchResults.classList.add('hidden');
      await loadConversations();
      openConversation({ id: conv.id, name: u.username });
    });
    searchResults.appendChild(row);
  });
  searchResults.classList.remove('hidden');
});

// ---------------- Nouveau groupe ----------------
const groupModal = document.getElementById('new-group-modal');
let groupSelectedMembers = [];

document.getElementById('new-group-btn').addEventListener('click', () => {
  groupSelectedMembers = [];
  document.getElementById('group-name').value = '';
  document.getElementById('group-selected').innerHTML = '';
  groupModal.classList.remove('hidden');
});
document.getElementById('group-cancel').addEventListener('click', () => groupModal.classList.add('hidden'));

document.getElementById('group-members-search').addEventListener('input', async (e) => {
  const q = e.target.value.trim();
  const box = document.getElementById('group-members-results');
  if (!q) { box.innerHTML = ''; return; }
  const users = await api(`/auth/search?q=${encodeURIComponent(q)}`);
  box.innerHTML = '';
  users.forEach((u) => {
    const row = document.createElement('div');
    row.className = 'search-result-row';
    row.innerHTML = `<div class="avatar small">${initials(u.username)}</div><span>${u.username}</span>`;
    row.addEventListener('click', () => {
      if (!groupSelectedMembers.find((m) => m.id === u.id)) {
        groupSelectedMembers.push(u);
        renderGroupSelected();
      }
    });
    box.appendChild(row);
  });
});

function renderGroupSelected() {
  const box = document.getElementById('group-selected');
  box.innerHTML = '';
  groupSelectedMembers.forEach((u) => {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.textContent = u.username;
    box.appendChild(chip);
  });
}

document.getElementById('group-create').addEventListener('click', async () => {
  const name = document.getElementById('group-name').value.trim();
  if (!name || groupSelectedMembers.length === 0) return;
  const conv = await api('/chat/conversations', {
    method: 'POST',
    body: { is_group: true, name, member_ids: groupSelectedMembers.map((m) => m.id) },
  });
  groupModal.classList.add('hidden');
  await loadConversations();
  openConversation({ id: conv.id, name, is_group: true });
});

// ---------------- Navigation mobile (retour / menu) ----------------
document.getElementById('back-to-list').addEventListener('click', () => {
  document.getElementById('sidebar').classList.remove('mobile-hidden');
});
document.getElementById('mobile-menu-btn').addEventListener('click', () => {
  document.getElementById('sidebar').classList.remove('mobile-hidden');
});

// ---------------- Onglets Messages / Fil de Stories / nav basse ----------------
function showMainView(view) {
  document.querySelectorAll('.main-tab').forEach((t) => t.classList.toggle('active', t.dataset.view === view));
  document.getElementById('stories-feed').classList.toggle('hidden', view !== 'stories');
  document.getElementById('coming-soon-panel').classList.add('hidden');
  document.getElementById('empty-state').classList.toggle('hidden', view === 'stories' || !!activeConversationId);
  document.getElementById('chat-window').classList.toggle('hidden', view === 'stories' || !activeConversationId);
  if (view === 'stories') loadStoryFeed();

  // Nav basse mobile : "messages" ouvre la liste des conversations
  if (view === 'messages') document.getElementById('sidebar').classList.remove('mobile-hidden');
  setBottomNavActive(view === 'stories' ? 'accueil' : 'messages');
}

document.querySelectorAll('.main-tab').forEach((tab) => {
  tab.addEventListener('click', () => showMainView(tab.dataset.view));
});

function setBottomNavActive(key) {
  document.querySelectorAll('.bn-item').forEach((b) => b.classList.toggle('active', b.dataset.bn === key));
}

function showComingSoon(title, text) {
  document.getElementById('stories-feed').classList.add('hidden');
  document.getElementById('empty-state').classList.add('hidden');
  document.getElementById('chat-window').classList.add('hidden');
  document.getElementById('coming-soon-panel').classList.remove('hidden');
  document.getElementById('coming-soon-title').textContent = title;
  document.getElementById('coming-soon-text').textContent = text;
  document.getElementById('sidebar').classList.add('mobile-hidden');
}

function showToast(message) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = message;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2200);
}

document.querySelectorAll('.bn-item').forEach((btn) => {
  btn.addEventListener('click', () => {
    const key = btn.dataset.bn;
    setBottomNavActive(key);
    if (key === 'accueil') {
      document.querySelectorAll('.main-tab').forEach((t) => t.classList.toggle('active', t.dataset.view === 'stories'));
      document.getElementById('sidebar').classList.add('mobile-hidden');
      document.getElementById('stories-feed').classList.remove('hidden');
      document.getElementById('coming-soon-panel').classList.add('hidden');
      document.getElementById('empty-state').classList.add('hidden');
      document.getElementById('chat-window').classList.add('hidden');
      loadStoryFeed();
    } else if (key === 'messages') {
      showMainView('messages');
    } else if (key === 'explorer') {
      showComingSoon('Explorer arrive bientôt', 'La recherche et la découverte de publications seront disponibles ici.');
    } else if (key === 'profil') {
      showComingSoon('Profil arrive bientôt', 'Ta page de profil, tes abonnés et tes badges seront bientôt ici.');
    }
  });
});

// ---------------- Feuille de création (+) ----------------
const createSheet = document.getElementById('create-sheet');
document.getElementById('bn-create-btn').addEventListener('click', () => createSheet.classList.remove('hidden'));
document.getElementById('create-sheet-cancel').addEventListener('click', () => createSheet.classList.add('hidden'));
createSheet.addEventListener('click', (e) => { if (e.target === createSheet) createSheet.classList.add('hidden'); });

document.querySelectorAll('.create-option').forEach((opt) => {
  opt.addEventListener('click', () => {
    createSheet.classList.add('hidden');
    const kind = opt.dataset.create;
    if (kind === 'story') {
      document.getElementById('add-story-btn').click();
    } else if (kind === 'post') {
      showToast('Les publications photo/vidéo arrivent bientôt');
    } else if (kind === 'texte') {
      showToast('Les publications texte arrivent bientôt');
    } else if (kind === 'media') {
      showToast('Le partage de fichiers arrive bientôt');
    }
  });
});

function timeAgo(iso) {
  const diffMin = Math.max(1, Math.round((Date.now() - new Date(iso + 'Z').getTime()) / 60000));
  if (diffMin < 60) return `il y a ${diffMin} min`;
  const h = Math.round(diffMin / 60);
  return `il y a ${h} h`;
}

async function loadStoryFeed() {
  const groups = await api('/stories/feed');
  const feed = document.getElementById('stories-feed');
  feed.innerHTML = '';

  const allStories = groups.flatMap((g) => g.stories).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  if (allStories.length === 0) {
    feed.innerHTML = '<div class="feed-empty">Aucune story active pour le moment. Publie la première !</div>';
    return;
  }

  allStories.forEach((s) => feed.appendChild(renderStoryCard(s)));
}

function renderStoryCard(s) {
  const card = document.createElement('div');
  card.className = 'story-card';

  const sharedLine = s.shared_from_username
    ? `<div class="story-card-shared">🔁 a repartagé la story de ${s.shared_from_username}</div>`
    : '';

  card.innerHTML = `
    <div class="story-card-header">
      <div class="avatar small">${initials(s.username)}</div>
      <div>
        <div class="who">${s.username === me.username ? 'Vous' : s.username}</div>
        <div class="when">${timeAgo(s.created_at)} · disparaît dans 24h</div>
      </div>
    </div>
    ${sharedLine}
    <img src="${s.media_url}" alt="story" />
    ${s.caption ? `<div class="story-card-caption">${s.caption}</div>` : ''}
    <div class="story-card-actions">
      <button class="story-action like-btn ${s.liked_by_me ? 'liked' : ''}">❤️ <span class="like-count">${s.like_count}</span></button>
      <button class="story-action comment-toggle">💬 <span class="comment-count">${s.comment_count}</span></button>
      <button class="story-action share-btn">🔁 Repartager</button>
    </div>
    <div class="story-comments hidden">
      <div class="comments-list"></div>
      <form class="story-comment-form">
        <input type="text" placeholder="Ajouter un commentaire..." />
        <button type="submit">Envoyer</button>
      </form>
    </div>
  `;

  card.querySelector('.like-btn').addEventListener('click', async (e) => {
    const data = await api(`/stories/${s.id}/like`, { method: 'POST' });
    e.currentTarget.classList.toggle('liked', data.liked);
    e.currentTarget.querySelector('.like-count').textContent = data.like_count;
  });

  const commentsBox = card.querySelector('.story-comments');
  const commentsList = card.querySelector('.comments-list');

  card.querySelector('.comment-toggle').addEventListener('click', async () => {
    commentsBox.classList.toggle('hidden');
    if (!commentsBox.classList.contains('hidden')) {
      const comments = await api(`/stories/${s.id}/comments`);
      commentsList.innerHTML = comments
        .map((c) => `<div class="story-comment"><span class="c-author">${c.username}</span>${c.content}</div>`)
        .join('');
    }
  });

  card.querySelector('.story-comment-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = e.target.querySelector('input');
    const content = input.value.trim();
    if (!content) return;
    const comment = await api(`/stories/${s.id}/comments`, { method: 'POST', body: { content } });
    commentsList.insertAdjacentHTML(
      'beforeend',
      `<div class="story-comment"><span class="c-author">${comment.username}</span>${comment.content}</div>`
    );
    card.querySelector('.comment-count').textContent = Number(card.querySelector('.comment-count').textContent) + 1;
    input.value = '';
  });

  card.querySelector('.share-btn').addEventListener('click', async () => {
    await api(`/stories/${s.id}/share`, { method: 'POST' });
    loadStoryFeed();
    loadStories();
  });

  return card;
}

// ---------------- Stories (barre rapide) ----------------
async function loadStories() {
  const groups = await api('/stories/feed');
  const bar = document.getElementById('stories-bar');
  // On garde le bouton "Votre story" et on retire le reste
  bar.querySelectorAll('.story-item:not(.add-story)').forEach((n) => n.remove());

  groups.forEach((g) => {
    const item = document.createElement('div');
    item.className = 'story-item';
    const allSeen = g.stories.every((s) => s.viewed_by_me);
    item.innerHTML = `
      <div class="story-ring ${allSeen ? 'seen' : ''}"><div class="avatar">${initials(g.username)}</div></div>
      <span class="story-label">${g.user_id === me.id ? 'Vous' : g.username}</span>`;
    item.addEventListener('click', () => openStoryViewer(g));
    bar.appendChild(item);
  });
}

document.getElementById('add-story-btn').addEventListener('click', () => {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*,video/*';
  input.onchange = async () => {
    if (!input.files[0]) return;
    const media_url = await uploadFile(input.files[0]);
    await api('/stories', { method: 'POST', body: { media_url } });
    loadStories();
    if (!document.getElementById('stories-feed').classList.contains('hidden')) loadStoryFeed();
  };
  input.click();
});

let storyQueue = [];
let storyIndex = 0;
let storyTimer = null;

function openStoryViewer(group) {
  storyQueue = group.stories;
  storyIndex = 0;
  document.getElementById('story-username').textContent = group.username;
  document.getElementById('story-avatar').textContent = initials(group.username);
  document.getElementById('story-viewer').classList.remove('hidden');
  showCurrentStory();
}

function showCurrentStory() {
  const story = storyQueue[storyIndex];
  if (!story) return closeStoryViewer();

  document.getElementById('story-media').src = story.media_url;
  document.getElementById('story-caption').textContent = story.caption || '';
  api(`/stories/${story.id}/view`, { method: 'POST' }).catch(() => {});

  const bar = document.getElementById('story-progress');
  bar.innerHTML = '';
  const fill = document.createElement('div');
  fill.style.cssText = 'height:100%;width:0;background:white;border-radius:3px;transition:width 5s linear;';
  bar.appendChild(fill);
  requestAnimationFrame(() => (fill.style.width = '100%'));

  clearTimeout(storyTimer);
  storyTimer = setTimeout(() => {
    storyIndex++;
    showCurrentStory();
  }, 5000);
}

function closeStoryViewer() {
  clearTimeout(storyTimer);
  document.getElementById('story-viewer').classList.add('hidden');
  loadStories();
}
document.getElementById('story-close').addEventListener('click', closeStoryViewer);

// ---------------- PWA : enregistrement du service worker ----------------
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/service-worker.js').catch(() => {});
  });
}

// ---------------- Auto-connexion si token déjà présent ----------------
if (token) startApp();
