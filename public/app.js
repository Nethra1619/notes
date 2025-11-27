// public/app.js
// READ: This runs in browser. It uses the client Firebase SDK to sign-in the user and obtain an ID token.
// The server verifies the ID token and returns user-specific data.

const firebaseConfig = window.FIREBASE_CLIENT_CONFIG;
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();

const API_PREFIX = ''; // same origin when served by server
let idToken = null;
let currentPage = 'notes';
let notes = [];
let trash = [];
let selectedNoteId = null;

document.addEventListener('DOMContentLoaded', () => {
  initAuthUI();
  initUI();
});

// ---------- AUTH ----------
function initAuthUI(){
  const signInBtn = document.getElementById('signinBtn');
  const signOutBtn = document.getElementById('signoutBtn');
  const userInfo = document.getElementById('userInfo');
  const userPhoto = document.getElementById('userPhoto');
  const userEmail = document.getElementById('userEmail');

  signInBtn.addEventListener('click', async () => {
    const provider = new firebase.auth.GoogleAuthProvider();
    try {
      const result = await auth.signInWithPopup(provider);
      await onUserChanged(result.user);
    } catch (err) {
      alert('Sign-in failed: ' + err.message);
      console.error(err);
    }
  });

  signOutBtn.addEventListener('click', async () => {
    await auth.signOut();
    idToken = null;
    userInfo.style.display = 'none';
    document.getElementById('authArea').style.display = 'block';
  });

  auth.onAuthStateChanged(async (user) => {
    if (user) await onUserChanged(user);
    else {
      idToken = null;
      document.getElementById('authArea').style.display = 'block';
      userInfo.style.display = 'none';
    }
  });

  async function onUserChanged(user) {
    document.getElementById('authArea').style.display = 'none';
    userInfo.style.display = 'flex';
    userPhoto.src = user.photoURL || '';
    userEmail.textContent = user.email || '';
    idToken = await user.getIdToken();
    // fetch user data now
    await fetchNotes();
    await fetchTrash();
  }
}

// ---------- UI init ----------
function initUI(){
  document.getElementById('addBtn').addEventListener('click', () => {
    if (currentPage === 'notes') createNote();
    else if (currentPage === 'todo') createTodo();
  });

  const fileInput = document.getElementById('fileInput');
  fileInput.addEventListener('change', handleFileImport);

  // default page
  switchPage('notes');
}

function switchPage(page){
  currentPage = page;
  document.querySelectorAll('.menu button').forEach(b => b.classList.remove('active'));
  document.getElementById('menu-' + page).classList.add('active');
  document.getElementById('pageTitle').innerText = page === 'notes' ? 'Simple Notes' : page === 'todo' ? 'To-Do List' : page.charAt(0).toUpperCase()+page.slice(1);
  render();
}

// ---------- API helpers ----------
async function apiFetch(url, opts = {}) {
  const headers = opts.headers || {};
  if (idToken) headers['Authorization'] = 'Bearer ' + idToken;
  opts.headers = headers;
  const res = await fetch(url, opts);
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(txt || 'API error');
  }
  return res.json();
}

// ---------- Notes / Trash fetch ----------
async function fetchNotes(){
  if (!idToken) { notes = []; render(); return; }
  try {
    notes = await apiFetch('/api/notes');
  } catch (err) { console.error(err); alert('Failed to fetch notes'); notes = []; }
  render();
}
async function fetchTrash(){
  if (!idToken) { trash = []; return; }
  try { trash = await apiFetch('/api/trash'); } catch (err) { console.error(err); trash = []; }
}

// ---------- Render ----------
function render(){
  if (currentPage === 'notes') renderNotes();
  else if (currentPage === 'todo') renderTodos();
  else if (currentPage === 'templates') renderTemplates();
  else if (currentPage === 'import') renderImport();
  else if (currentPage === 'trash') renderTrash();
}

function renderNotes(){
  const left = document.getElementById('leftCol');
  left.innerHTML = '';
  if (!idToken) {
    left.innerHTML = '<div class="note-card"><small class="small-muted">Sign in to view your notes</small></div>';
    return;
  }
  notes.slice().reverse().forEach(n => {
    const card = document.createElement('div');
    card.className = 'note-card';
    card.innerHTML = `
      <div style="flex:1">
        <div style="font-weight:600">${(n.text || 'Untitled').substring(0,120)}</div>
        <small class="small-muted">${n.file ? '📎 ' + n.file.name : ''}</small>
      </div>
      <div style="display:flex;flex-direction:column;gap:6px">
        <button onclick="editNote(event,'${n.id}')">Edit</button>
        <button onclick="deleteNote(event,'${n.id}')">Delete</button>
      </div>
    `;
    card.addEventListener('click', (e) => {
      if (e.target.tagName.toLowerCase() === 'button') return;
      openDetail(n.id);
    });
    left.appendChild(card);
  });
}

function renderTodos(){
  const left = document.getElementById('leftCol');
  left.innerHTML = '<h3>To-Do List</h3>';
  notes.forEach(n=>{
    if(n.text && n.text.startsWith('todo:')){
      const div = document.createElement('div');
      div.className = 'todo-item';
      div.innerHTML = `<input type="checkbox" ${n.done ? 'checked' : ''} onclick="toggleTodo(event,'${n.id}')"> <div>${n.text.replace(/^todo:/,'')}</div>`;
      left.appendChild(div);
    }
  });
}

function renderTemplates(){
  const left = document.getElementById('leftCol');
  left.innerHTML = '<div class="note-card">Daily Planner Template</div><div class="note-card">Meeting Notes Template</div>';
}

function renderImport(){
  const left = document.getElementById('leftCol');
  left.innerHTML = '<p class="small-muted">Use Import to upload PDF or image; it will be stored and a note created that links to it.</p>';
}

function renderTrash(){
  const left = document.getElementById('leftCol');
  left.innerHTML = '';
  trash.slice().reverse().forEach(t=>{
    const d = document.createElement('div');
    d.className = 'note-card trash-note';
    d.innerHTML = `<div style="display:flex;justify-content:space-between;">
      <div><div style="font-weight:600">${(t.text||t.file?.name||'Deleted')}</div><small class="small-muted">${t.deletedAt ? new Date(t.deletedAt).toLocaleString():''}</small></div>
      <div>
        <button onclick="restore(event,'${t.id}')">Restore</button>
        <button onclick="permaDelete(event,'${t.id}')">Delete</button>
      </div>
    </div>`;
    left.appendChild(d);
  });
}

// ---------- Detail area ----------
function openDetail(id){
  const n = notes.find(x=>x.id===id);
  selectedNoteId = id;
  const area = document.getElementById('detailArea');
  if (!n) { area.innerHTML = ''; return; }
  area.innerHTML = `
    <div>
      <textarea id="noteText" style="width:100%;height:120px;border-radius:8px;padding:10px">${n.text||''}</textarea>
      <div style="margin-top:8px;display:flex;gap:8px;">
        <button class="btn" onclick="saveNote()">Save</button>
        <button class="btn secondary" onclick="openFile('${n.file ? n.file.url : ''}')">Open Attachment</button>
      </div>
    </div>
  `;
}

function openFile(url){ if(!url) return alert('No attachment'); window.open(url,'_blank'); }

// ---------- CRUD ----------
async function createNote(){
  if (!idToken) return alert('Sign in first');
  const text = prompt('Type your note:');
  if (!text) return;
  await apiFetch('/api/notes', {
    method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ text })
  });
  await fetchNotes();
}

async function editNote(e, id){
  e.stopPropagation();
  const n = notes.find(x=>x.id===id);
  const newText = prompt('Edit note', n.text || '');
  if (newText === null) return;
  if (newText === '') {
    if (!confirm('Move to trash?')) return;
    await apiFetch(`/api/notes/${id}`, { method: 'DELETE' });
    await fetchNotes(); await fetchTrash();
    return;
  }
  await apiFetch(`/api/notes/${id}`, {
    method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ text: newText })
  });
  await fetchNotes();
}

async function deleteNote(e,id){
  e.stopPropagation();
  if (!confirm('Move to trash?')) return;
  await apiFetch(`/api/notes/${id}`, { method:'DELETE' });
  await fetchNotes(); await fetchTrash();
}

async function saveNote(){
  const text = document.getElementById('noteText').value;
  if (!selectedNoteId) return alert('No note selected');
  await apiFetch(`/api/notes/${selectedNoteId}`, {
    method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ text })
  });
  await fetchNotes();
}

// ---------- File upload ----------
async function handleFileImport(e){
  if (!idToken) return alert('Sign in first');
  const file = e.target.files[0];
  if (!file) return;
  const fd = new FormData();
  fd.append('file', file);
  // attach idToken via Authorization header in fetch wrapper
  const res = await apiFetch('/api/upload', { method: 'POST', body: fd });
  // create a note containing file link
  await apiFetch('/api/notes', {
    method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ text: res.name, file: res })
  });
  await fetchNotes();
  e.target.value = '';
}

// ---------- Trash restore / delete ----------
async function restore(e,id){ e.stopPropagation(); await apiFetch(`/api/trash/restore/${id}`, { method:'POST' }); await fetchNotes(); await fetchTrash(); }
async function permaDelete(e,id){ e.stopPropagation(); if(!confirm('Permanently delete?')) return; await apiFetch(`/api/trash/${id}`, { method:'DELETE' }); await fetchTrash(); }

// ---------- helper (todos demo) ----------
async function toggleTodo(e,id){
  e.stopPropagation();
  const note = notes.find(n=>n.id===id);
  note.done = !note.done;
  await apiFetch(`/api/notes/${id}`, { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ done: note.done }) });
  await fetchNotes();
}
