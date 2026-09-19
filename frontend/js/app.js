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
  document.getElementById('bottom-nav').classList.remove('hidden');

  if (!me) me = await api('/auth/me');
  document.getElementById('me-username').textContent = me.username;
  document.getElementById('me-avatar').textContent = initials(me.username);
  if (me.avatar_url) {
    const meAvatarEl = document.getElementById('me-avatar');
    meAvatarEl.style.backgroundImage = `url(${me.avatar_url})`;
    meAvatarEl.textContent = '';
  }

  connectSocket();
  loadConversations();
  loadStories();
  loadNotifications();
  document.getElementById('notif-widget').classList.remove('hidden');
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

  socket.on('notification', (n) => {
    notifications.unshift(n);
    unreadCount += 1;
    renderNotifPanel();
    updateNotifBadge();
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
      searchInput.value = '';
      searchResults.classList.add('hidden');

      const profile = await api(`/users/${encodeURIComponent(u.username)}`);
      if (profile.can_message) {
        const conv = await api('/chat/conversations', { method: 'POST', body: { member_ids: [u.id], is_group: false } });
        await loadConversations();
        openConversation({ id: conv.id, name: u.username });
      } else if (profile.relationship === 'pending') {
        showToast(`Demande déjà envoyée à ${u.username}, en attente d'acceptation.`);
      } else {
        await api(`/users/${encodeURIComponent(u.username)}/follow`, { method: 'POST' });
        showToast(`Demande d'abonnement envoyée à ${u.username}. Tu pourras lui écrire une fois accepté(e).`);
      }
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
  document.getElementById('posts-feed').classList.toggle('hidden', view !== 'posts');
  document.getElementById('profile-panel').classList.toggle('hidden', view !== 'profil');
  document.getElementById('coming-soon-panel').classList.add('hidden');
  document.getElementById('empty-state').classList.toggle('hidden', view !== 'messages' || !!activeConversationId);
  document.getElementById('chat-window').classList.toggle('hidden', view !== 'messages' || !activeConversationId);
  if (view === 'stories') loadStoryFeed();
  if (view === 'posts') loadPostFeed();
  if (view === 'profil') loadProfilePanel(me.username);

  // Nav basse mobile : "messages" ouvre la liste des conversations
  if (view === 'messages') document.getElementById('sidebar').classList.remove('mobile-hidden');
  else document.getElementById('sidebar').classList.add('mobile-hidden');
  setBottomNavActive(view === 'messages' ? 'messages' : view === 'profil' ? 'profil' : 'accueil');
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
    if (key === 'accueil') {
      showMainView('posts');
    } else if (key === 'messages') {
      showMainView('messages');
    } else if (key === 'explorer') {
      setBottomNavActive('explorer');
      showComingSoon('Explorer arrive bientôt', 'La recherche et la découverte de publications seront disponibles ici.');
    } else if (key === 'profil') {
      showMainView('profil');
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
    } else if (kind === 'post' || kind === 'texte') {
      openPostModal();
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

// ---------------- Page Profil ----------------
async function loadProfilePanel(username) {
  const panel = document.getElementById('profile-panel');
  panel.innerHTML = '<div class="feed-empty">Chargement...</div>';

  const profile = await api(`/users/${encodeURIComponent(username)}`);
  const userPosts = await api(`/posts?user_id=${encodeURIComponent(profile.id)}`).catch(() => []);

  panel.innerHTML = '';
  panel.appendChild(renderProfileHeader(profile));

  if (profile.relationship === 'me') {
    const reqBox = await renderRequestsBox();
    if (reqBox) panel.appendChild(reqBox);
  }

  const title = document.createElement('div');
  title.className = 'profile-posts-title';
  title.textContent = 'Publications';
  panel.appendChild(title);

  if (userPosts.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'feed-empty';
    empty.textContent = 'Aucune publication pour le moment.';
    panel.appendChild(empty);
  } else {
    userPosts.forEach((p) => panel.appendChild(renderPostCard(p)));
  }
}

function renderProfileHeader(p) {
  const card = document.createElement('div');
  card.className = 'profile-header';

  const badgeHtml = p.badge === 'gold' ? '<span class="badge badge-gold">👑</span>' : p.badge ? '<span class="badge badge-check">✔️</span>' : '';

  let actionsHtml = '';
  if (p.relationship === 'me') {
    actionsHtml = `<button class="profile-edit-btn" id="edit-profile-btn">Modifier mon profil</button>`;
  } else if (p.relationship === 'accepted') {
    actionsHtml = `<button class="profile-follow-btn" disabled style="opacity:0.7;">Abonné(e) ✓</button>`;
  } else if (p.relationship === 'pending') {
    actionsHtml = `<button class="profile-follow-btn pending" disabled>Demande envoyée</button>`;
  } else {
    actionsHtml = `<button class="profile-follow-btn" id="follow-btn">+ S'abonner</button>`;
  }

  card.innerHTML = `
    <div class="profile-avatar-big" style="${p.avatar_url ? `background-image:url(${p.avatar_url});` : ''}">${p.avatar_url ? '' : initials(p.username)}</div>
    <div class="profile-name">${p.username} ${badgeHtml}</div>
    ${p.bio ? `<div class="profile-bio">${escapeHtml(p.bio)}</div>` : ''}
    <div class="profile-stats">
      <div class="profile-stat"><b>${p.post_count}</b><span>Posts</span></div>
      <div class="profile-stat"><b>${p.follower_count}</b><span>Abonnés</span></div>
      <div class="profile-stat"><b>${p.following_count}</b><span>Abonnements</span></div>
    </div>
    <div class="profile-actions">${actionsHtml}</div>
  `;

  const editBtn = card.querySelector('#edit-profile-btn');
  if (editBtn) editBtn.addEventListener('click', () => openEditProfileModal(p));

  const followBtn = card.querySelector('#follow-btn');
  if (followBtn) {
    followBtn.addEventListener('click', async () => {
      await api(`/users/${encodeURIComponent(p.username)}/follow`, { method: 'POST' });
      loadProfilePanel(p.username);
    });
  }

  return card;
}

async function renderRequestsBox() {
  const requests = await api('/users/me/requests');
  if (requests.length === 0) return null;

  const box = document.createElement('div');
  box.className = 'profile-requests';
  box.innerHTML = `<h4>Demandes d'abonnement (${requests.length})</h4>`;

  requests.forEach((r) => {
    const row = document.createElement('div');
    row.className = 'request-row';
    row.innerHTML = `
      <div class="avatar small">${initials(r.username)}</div>
      <span>${r.username}</span>
      <button class="req-accept">Accepter</button>
      <button class="req-decline">Refuser</button>
    `;
    row.querySelector('.req-accept').addEventListener('click', async () => {
      await api(`/users/requests/${r.follower_id}/respond`, { method: 'POST', body: { accept: true } });
      loadProfilePanel(me.username);
    });
    row.querySelector('.req-decline').addEventListener('click', async () => {
      await api(`/users/requests/${r.follower_id}/respond`, { method: 'POST', body: { accept: false } });
      loadProfilePanel(me.username);
    });
    box.appendChild(row);
  });

  return box;
}

// ---------------- Édition de profil ----------------
const editProfileModal = document.getElementById('edit-profile-modal');
const editBioInput = document.getElementById('edit-bio-input');
const editAvatarInput = document.getElementById('edit-avatar-input');
const editProfileError = document.getElementById('edit-profile-error');
let pendingAvatarUrl = null;

function openEditProfileModal(p) {
  editBioInput.value = p.bio || '';
  editAvatarInput.value = '';
  editProfileError.textContent = '';
  pendingAvatarUrl = null;
  editProfileModal.classList.remove('hidden');
}

document.getElementById('edit-profile-cancel').addEventListener('click', () => editProfileModal.classList.add('hidden'));
editProfileModal.addEventListener('click', (e) => { if (e.target === editProfileModal) editProfileModal.classList.add('hidden'); });

editAvatarInput.addEventListener('change', async () => {
  const file = editAvatarInput.files[0];
  if (!file) return;
  try {
    const form = new FormData();
    form.append('file', file);
    const { url } = await api('/upload', { method: 'POST', body: form, isForm: true });
    pendingAvatarUrl = url;
  } catch (err) {
    editProfileError.textContent = err.message;
  }
});

document.getElementById('edit-profile-save').addEventListener('click', async () => {
  try {
    const updated = await api('/users/me', {
      method: 'PATCH',
      body: { bio: editBioInput.value.trim(), avatar_url: pendingAvatarUrl },
    });
    me.avatar_url = updated.avatar_url;
    me.bio = updated.bio;
    if (updated.avatar_url) {
      const meAvatarEl = document.getElementById('me-avatar');
      meAvatarEl.style.backgroundImage = `url(${updated.avatar_url})`;
      meAvatarEl.textContent = '';
    }
    editProfileModal.classList.add('hidden');
    loadProfilePanel(me.username);
  } catch (err) {
    editProfileError.textContent = err.message;
  }
});

// ---------------- Notifications ----------------
let notifications = [];
let unreadCount = 0;

const notifLabels = {
  like: 'a aimé ta publication',
  comment: 'a commenté ta publication',
  share: 'a repartagé ta publication',
  message: "t'a envoyé un message",
  follow_request: 'veut s\'abonner à toi',
  follow_accept: 'a accepté ton abonnement',
};

async function loadNotifications() {
  notifications = await api('/notifications');
  unreadCount = notifications.filter((n) => !n.is_read).length;
  renderNotifPanel();
  updateNotifBadge();
}

function updateNotifBadge() {
  const badge = document.getElementById('notif-badge');
  if (unreadCount > 0) {
    badge.textContent = unreadCount > 9 ? '9+' : unreadCount;
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }
}

function renderNotifPanel() {
  const list = document.getElementById('notif-list');
  if (notifications.length === 0) {
    list.innerHTML = '<div class="notif-empty">Aucune notification pour le moment.</div>';
    return;
  }
  list.innerHTML = notifications
    .map(
      (n) => `
    <div class="notif-row ${n.is_read ? '' : 'unread'}" data-id="${n.id}" data-type="${n.type}" data-conv="${n.conversation_id || ''}">
      <div class="avatar small">${initials(n.actor_username)}</div>
      <div>
        <div class="notif-text"><b>${n.actor_username}</b> ${notifLabels[n.type] || ''}</div>
        <div class="notif-time">${timeAgo(n.created_at)}</div>
      </div>
    </div>`
    )
    .join('');

  list.querySelectorAll('.notif-row').forEach((row) => {
    row.addEventListener('click', async () => {
      const id = row.dataset.id;
      const n = notifications.find((x) => x.id === id);
      if (n && !n.is_read) {
        n.is_read = 1;
        unreadCount = Math.max(0, unreadCount - 1);
        updateNotifBadge();
        row.classList.remove('unread');
        api(`/notifications/${id}/read`, { method: 'POST' }).catch(() => {});
      }
      document.getElementById('notif-panel').classList.add('hidden');
      if (row.dataset.type === 'message' && row.dataset.conv) {
        showMainView('messages');
        openConversation({ id: row.dataset.conv, name: n?.actor_username });
      } else if (['like', 'comment', 'share'].includes(row.dataset.type)) {
        showMainView('posts');
      } else if (['follow_request', 'follow_accept'].includes(row.dataset.type)) {
        showMainView('profil');
      }
    });
  });
}

document.getElementById('notif-bell').addEventListener('click', () => {
  document.getElementById('notif-panel').classList.toggle('hidden');
});
document.addEventListener('click', (e) => {
  const widget = document.getElementById('notif-widget');
  if (!widget.contains(e.target)) document.getElementById('notif-panel').classList.add('hidden');
});
document.getElementById('notif-mark-all').addEventListener('click', async () => {
  await api('/notifications/read-all', { method: 'POST' });
  notifications.forEach((n) => (n.is_read = 1));
  unreadCount = 0;
  renderNotifPanel();
  updateNotifBadge();
});

// ---------------- Fil de publications (Accueil) ----------------
async function loadPostFeed() {
  const posts = await api('/posts');
  const feed = document.getElementById('posts-feed');
  feed.innerHTML = '';

  if (posts.length === 0) {
    feed.innerHTML = '<div class="feed-empty">Aucune publication pour le moment. Sois le premier à publier !</div>';
    return;
  }

  posts.forEach((p) => feed.appendChild(renderPostCard(p)));
}

function renderPostCard(p) {
  const card = document.createElement('div');
  card.className = 'story-card';

  const sharedLine = p.shared_from_username
    ? `<div class="story-card-shared">🔁 a repartagé la publication de ${p.shared_from_username}</div>`
    : '';

  card.innerHTML = `
    <div class="story-card-header">
      <div class="avatar small">${initials(p.username)}</div>
      <div>
        <div class="who">${p.username === me.username ? 'Vous' : p.username}</div>
        <div class="when">${timeAgo(p.created_at)}</div>
      </div>
    </div>
    ${sharedLine}
    ${p.content ? `<div class="story-card-caption" style="padding-top:10px;">${escapeHtml(p.content)}</div>` : ''}
    ${p.media_url ? `<img src="${p.media_url}" alt="publication" />` : ''}
    <div class="story-card-actions">
      <button class="story-action like-btn ${p.liked_by_me ? 'liked' : ''}">❤️ <span class="like-count">${p.like_count}</span></button>
      <button class="story-action comment-toggle">💬 <span class="comment-count">${p.comment_count}</span></button>
      <button class="story-action share-btn">🔁 <span class="share-count">${p.share_count}</span></button>
      <button class="story-action bookmark-btn ${p.bookmarked_by_me ? 'liked' : ''}">${p.bookmarked_by_me ? '🔖' : '📑'}</button>
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
    const data = await api(`/posts/${p.id}/like`, { method: 'POST' });
    e.currentTarget.classList.toggle('liked', data.liked);
    e.currentTarget.querySelector('.like-count').textContent = data.like_count;
  });

  card.querySelector('.bookmark-btn').addEventListener('click', async (e) => {
    const data = await api(`/posts/${p.id}/bookmark`, { method: 'POST' });
    e.currentTarget.classList.toggle('liked', data.bookmarked);
    e.currentTarget.textContent = data.bookmarked ? '🔖' : '📑';
  });

  const commentsBox = card.querySelector('.story-comments');
  const commentsList = card.querySelector('.comments-list');

  card.querySelector('.comment-toggle').addEventListener('click', async () => {
    commentsBox.classList.toggle('hidden');
    if (!commentsBox.classList.contains('hidden')) {
      const comments = await api(`/posts/${p.id}/comments`);
      commentsList.innerHTML = comments
        .map((c) => `<div class="story-comment"><span class="c-author">${c.username}</span>${escapeHtml(c.content)}</div>`)
        .join('');
    }
  });

  card.querySelector('.story-comment-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = e.target.querySelector('input');
    const content = input.value.trim();
    if (!content) return;
    const comment = await api(`/posts/${p.id}/comments`, { method: 'POST', body: { content } });
    commentsList.insertAdjacentHTML(
      'beforeend',
      `<div class="story-comment"><span class="c-author">${comment.username}</span>${escapeHtml(comment.content)}</div>`
    );
    card.querySelector('.comment-count').textContent = Number(card.querySelector('.comment-count').textContent) + 1;
    input.value = '';
  });

  card.querySelector('.share-btn').addEventListener('click', async () => {
    await api(`/posts/${p.id}/share`, { method: 'POST' });
    loadPostFeed();
  });

  return card;
}

function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

// ---------------- Création de post (modale) ----------------
const postModal = document.getElementById('post-modal');
const postContentInput = document.getElementById('post-content-input');
const postMediaInput = document.getElementById('post-media-input');
const postMediaPreview = document.getElementById('post-media-preview');
const postModalError = document.getElementById('post-modal-error');
let pendingPostMediaUrl = null;

function openPostModal() {
  postContentInput.value = '';
  postMediaInput.value = '';
  postMediaPreview.classList.add('hidden');
  postModalError.textContent = '';
  pendingPostMediaUrl = null;
  postModal.classList.remove('hidden');
  postContentInput.focus();
}

document.getElementById('post-modal-cancel').addEventListener('click', () => postModal.classList.add('hidden'));
postModal.addEventListener('click', (e) => { if (e.target === postModal) postModal.classList.add('hidden'); });

postMediaInput.addEventListener('change', async () => {
  const file = postMediaInput.files[0];
  if (!file) return;
  postModalError.textContent = '';
  try {
    const form = new FormData();
    form.append('file', file);
    const { url } = await api('/upload', { method: 'POST', body: form, isForm: true });
    pendingPostMediaUrl = url;
    postMediaPreview.src = url;
    postMediaPreview.classList.remove('hidden');
  } catch (err) {
    postModalError.textContent = err.message;
  }
});

document.getElementById('post-modal-submit').addEventListener('click', async () => {
  const content = postContentInput.value.trim();
  if (!content && !pendingPostMediaUrl) {
    postModalError.textContent = 'Écris quelque chose ou ajoute un média.';
    return;
  }
  try {
    await api('/posts', { method: 'POST', body: { content, media_url: pendingPostMediaUrl } });
    postModal.classList.add('hidden');
    showMainView('posts');
  } catch (err) {
    postModalError.textContent = err.message;
  }
});

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
