// ── Config ────────────────────────────────────────────────────────────────────
// Fill these in after completing the setup steps
const GITHUB_CLIENT_ID  = 'Ov23liaD79TCnx8NW2IE';
const OAUTH_HANDLER_URL = 'https://hwaneest-memo-oauth.netlify.app/.netlify/functions/oauth';
const GIST_DESCRIPTION  = 'memo-app-hwaneest';
const GIST_FILENAME     = 'data.json';

// ── DOM refs ──────────────────────────────────────────────────────────────────
const loginScreen  = document.getElementById('loginScreen');
const appEl        = document.getElementById('app');
const loginBtn     = document.getElementById('loginBtn');
const logoutBtn    = document.getElementById('logoutBtn');
const memoList     = document.getElementById('memoList');
const titleInput   = document.getElementById('titleInput');
const bodyInput    = document.getElementById('bodyInput');
const newBtn       = document.getElementById('newBtn');
const deleteBtn    = document.getElementById('deleteBtn');
const lastSaved    = document.getElementById('lastSaved');

// ── Auth state ────────────────────────────────────────────────────────────────
let token  = localStorage.getItem('gh_token');
let gistId = localStorage.getItem('gh_gist_id');

// ── App state ─────────────────────────────────────────────────────────────────
let memos     = [];
let todos     = [];
let currentId = null;
let saveTimer = null;
let gistSaveTimer = null;

// ── Login / logout ────────────────────────────────────────────────────────────
function showLogin() {
  loginScreen.style.display = 'flex';
  appEl.style.display = 'none';
}

function showApp() {
  loginScreen.style.display = 'none';
  appEl.style.display = 'flex';
}

loginBtn.addEventListener('click', () => {
  const redirectUri = encodeURIComponent(window.location.href.split('?')[0]);
  window.location.href =
    `https://github.com/login/oauth/authorize?client_id=${GITHUB_CLIENT_ID}&scope=gist&redirect_uri=${redirectUri}`;
});

logoutBtn.addEventListener('click', () => {
  localStorage.removeItem('gh_token');
  localStorage.removeItem('gh_gist_id');
  token  = null;
  gistId = null;
  showLogin();
});

// ── OAuth callback ────────────────────────────────────────────────────────────
async function exchangeCode(code) {
  lastSaved.textContent = 'Signing in…';
  try {
    const res  = await fetch(`${OAUTH_HANDLER_URL}?code=${code}`);
    const data = await res.json();
    if (data.access_token) {
      token = data.access_token;
      localStorage.setItem('gh_token', token);
      window.history.replaceState({}, document.title, window.location.pathname);
      await initApp();
    } else {
      showLogin();
    }
  } catch {
    showLogin();
  }
}

// ── GitHub Gist API ───────────────────────────────────────────────────────────
async function ghFetch(path, options = {}) {
  return fetch(`https://api.github.com${path}`, {
    ...options,
    headers: {
      'Authorization': `token ${token}`,
      'Accept': 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
}

async function findOrCreateGist() {
  if (gistId) return gistId;

  const res   = await ghFetch('/gists');
  const gists = await res.json();
  const found = gists.find(g => g.description === GIST_DESCRIPTION);

  if (found) {
    gistId = found.id;
    localStorage.setItem('gh_gist_id', gistId);
    return gistId;
  }

  const empty = JSON.stringify({ memos: [], todos: [] });
  const createRes  = await ghFetch('/gists', {
    method: 'POST',
    body: JSON.stringify({
      description: GIST_DESCRIPTION,
      public: false,
      files: { [GIST_FILENAME]: { content: empty } }
    })
  });
  const newGist = await createRes.json();
  gistId = newGist.id;
  localStorage.setItem('gh_gist_id', gistId);
  return gistId;
}

async function loadFromGist() {
  const id  = await findOrCreateGist();
  const res = await ghFetch(`/gists/${id}`);
  const gist = await res.json();
  const content = gist.files[GIST_FILENAME]?.content || '{"memos":[],"todos":[]}';
  return JSON.parse(content);
}

async function saveToGist() {
  if (!token) return;
  try {
    const id = await findOrCreateGist();
    await ghFetch(`/gists/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        files: {
          [GIST_FILENAME]: {
            content: JSON.stringify({ memos, todos })
          }
        }
      })
    });
    lastSaved.textContent = 'Synced ' + formatDate(Date.now());
  } catch {
    lastSaved.textContent = 'Sync failed — check connection';
  }
}

function scheduleSave() {
  clearTimeout(gistSaveTimer);
  lastSaved.textContent = 'Saving…';
  gistSaveTimer = setTimeout(saveToGist, 2000);
}

// ── Memo helpers ──────────────────────────────────────────────────────────────
function formatDate(ts) {
  const d = new Date(ts);
  return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function render() {
  memoList.innerHTML = '';
  memos.forEach(m => {
    const li = document.createElement('li');
    if (m.id === currentId) li.classList.add('active');

    const info = document.createElement('div');
    info.className = 'memo-info';

    const title = document.createElement('div');
    title.className = 'memo-title';
    title.textContent = m.title || 'Untitled';

    const preview = document.createElement('div');
    preview.className = 'memo-preview';
    preview.textContent = m.body.replace(/\n/g, ' ') || 'No content';

    info.appendChild(title);
    info.appendChild(preview);

    const del = document.createElement('button');
    del.className = 'memo-del';
    del.textContent = '×';
    del.addEventListener('click', e => {
      e.stopPropagation();
      const targetId = m.id;
      showConfirm('Delete this memo?', () => {
        memos = memos.filter(m => m.id !== targetId);
        if (currentId === targetId) {
          currentId = null;
          if (memos.length > 0) {
            selectMemo(memos[0].id);
          } else {
            titleInput.value = '';
            bodyInput.value = '';
            lastSaved.textContent = '';
            render();
          }
        } else {
          render();
        }
        scheduleSave();
      });
    });

    li.appendChild(info);
    li.appendChild(del);
    li.addEventListener('click', () => selectMemo(m.id));
    memoList.appendChild(li);
  });
}

function selectMemo(id) {
  currentId = id;
  const memo = memos.find(m => m.id === id);
  if (!memo) return;
  titleInput.value = memo.title;
  bodyInput.value  = memo.body;
  lastSaved.textContent = 'Synced ' + formatDate(memo.updatedAt);
  render();
}

function newMemo() {
  const memo = { id: Date.now().toString(), title: '', body: '', updatedAt: Date.now() };
  memos.unshift(memo);
  selectMemo(memo.id);
  titleInput.focus();
  scheduleSave();
}

function deleteMemo() {
  if (!currentId) return;
  memos = memos.filter(m => m.id !== currentId);
  currentId = null;
  if (memos.length > 0) {
    selectMemo(memos[0].id);
  } else {
    titleInput.value = '';
    bodyInput.value  = '';
    lastSaved.textContent = '';
    render();
  }
  scheduleSave();
}

function autoSave() {
  if (!currentId) return;
  const idx = memos.findIndex(m => m.id === currentId);
  if (idx === -1) return;
  memos[idx].title     = titleInput.value;
  memos[idx].body      = bodyInput.value;
  memos[idx].updatedAt = Date.now();
  const [updated] = memos.splice(idx, 1);
  memos.unshift(updated);
  render();
  scheduleSave();
}

titleInput.addEventListener('input', () => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(autoSave, 600);
});

bodyInput.addEventListener('input', () => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(autoSave, 600);
});

newBtn.addEventListener('click', newMemo);
deleteBtn.addEventListener('click', () => {
  if (!currentId) return;
  showConfirm('Delete this memo?', deleteMemo);
});

// ── Confirm modal ─────────────────────────────────────────────────────────────
const confirmOverlay  = document.getElementById('confirmOverlay');
const confirmOk       = document.getElementById('confirmOk');
const confirmCancel   = document.getElementById('confirmCancel');
const confirmMessage  = document.getElementById('confirmMessage');
let confirmCallback   = null;

function showConfirm(message, onConfirm) {
  confirmMessage.textContent = message;
  confirmCallback = onConfirm;
  confirmOverlay.classList.add('active');
}

function closeConfirm() {
  confirmCallback = null;
  confirmOverlay.classList.remove('active');
}

confirmOk.addEventListener('click', () => {
  if (confirmCallback) confirmCallback();
  closeConfirm();
});
confirmCancel.addEventListener('click', closeConfirm);
confirmOverlay.addEventListener('click', e => {
  if (e.target === confirmOverlay) closeConfirm();
});

// ── Todo ──────────────────────────────────────────────────────────────────────
const todoInputEl = document.getElementById('todoInput');
const todoAddBtn  = document.getElementById('todoAddBtn');
const todoListEl  = document.getElementById('todoList');
let lastDeleted   = null;

function saveTodos() {
  scheduleSave();
}

function renderTodos() {
  todoListEl.innerHTML = '';
  todos.forEach((t, i) => {
    const li = document.createElement('li');
    if (t.done) li.classList.add('done');

    const cb = document.createElement('input');
    cb.type    = 'checkbox';
    cb.checked = t.done;
    cb.addEventListener('change', () => {
      todos[i].done = cb.checked;
      saveTodos();
      renderTodos();
    });

    const span = document.createElement('span');
    span.className   = 'todo-text';
    span.textContent = t.text;

    const del = document.createElement('button');
    del.className   = 'todo-del';
    del.textContent = '×';
    del.addEventListener('click', () => {
      showConfirm('Delete this task?', () => {
        lastDeleted = { todo: todos[i], index: i };
        todos.splice(i, 1);
        saveTodos();
        renderTodos();
      });
    });

    li.appendChild(cb);
    li.appendChild(span);
    li.appendChild(del);
    todoListEl.appendChild(li);
  });
}

function addTodo() {
  const text = todoInputEl.value.trim();
  if (!text) return;
  todos.push({ text, done: false });
  saveTodos();
  renderTodos();
  todoInputEl.value = '';
}

todoAddBtn.addEventListener('click', addTodo);
todoInputEl.addEventListener('keydown', e => {
  if (e.key === 'Enter') addTodo();
});

// Undo last todo deletion (Cmd+Z / Ctrl+Z)
document.addEventListener('keydown', e => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'z' && lastDeleted) {
    e.preventDefault();
    todos.splice(lastDeleted.index, 0, lastDeleted.todo);
    saveTodos();
    renderTodos();
    lastDeleted = null;
  }
});

// ── Todo panel resize ─────────────────────────────────────────────────────────
const todoPanel    = document.getElementById('todoPanel');
const resizeHandle = document.getElementById('todoResizeHandle');

const savedWidth = localStorage.getItem('todoPanelWidth');
if (savedWidth) todoPanel.style.width = savedWidth + 'px';

resizeHandle.addEventListener('mousedown', e => {
  e.preventDefault();
  resizeHandle.classList.add('dragging');
  const startX     = e.clientX;
  const startWidth = todoPanel.offsetWidth;

  function onMouseMove(e) {
    const newWidth = Math.min(480, Math.max(160, startWidth + (startX - e.clientX)));
    todoPanel.style.width = newWidth + 'px';
  }

  function onMouseUp() {
    resizeHandle.classList.remove('dragging');
    localStorage.setItem('todoPanelWidth', todoPanel.offsetWidth);
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
  }

  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);
});

// ── Init ──────────────────────────────────────────────────────────────────────
async function initApp() {
  showApp();
  lastSaved.textContent = 'Loading…';
  try {
    const data = await loadFromGist();
    memos = data.memos || [];
    todos = data.todos || [];
  } catch {
    memos = [];
    todos = [];
    lastSaved.textContent = 'Could not load data';
  }
  renderTodos();
  if (memos.length > 0) {
    selectMemo(memos[0].id);
  } else {
    newMemo();
  }
}

// Entry point
const urlParams = new URLSearchParams(window.location.search);
const oauthCode = urlParams.get('code');

if (oauthCode) {
  showApp();
  exchangeCode(oauthCode);
} else if (token) {
  initApp();
} else {
  showLogin();
}
