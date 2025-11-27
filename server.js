// server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(express.json());

// CORS: allow your frontend origin (set ORIGIN in .env or allow all in dev)
const ORIGIN = process.env.ORIGIN || '*';
app.use(cors({ origin: ORIGIN }));

// Validate env
const { SERVICE_ACCOUNT_PATH, DATABASE_URL, STORAGE_BUCKET, PORT } = process.env;
if (!SERVICE_ACCOUNT_PATH || !DATABASE_URL || !STORAGE_BUCKET) {
  console.error('Please set SERVICE_ACCOUNT_PATH, DATABASE_URL and STORAGE_BUCKET in .env');
  process.exit(1);
}

// Initialize Firebase Admin
const serviceAccount = require(path.resolve(SERVICE_ACCOUNT_PATH));

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: DATABASE_URL,
  storageBucket: STORAGE_BUCKET,
});

const db = admin.database();
const bucket = admin.storage().bucket();

// Multer for temp uploads
const upload = multer({ dest: 'uploads/' });

// ----------------- Auth middleware -----------------
async function verifyTokenMiddleware(req, res, next) {
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Bearer ')) return res.status(401).json({ error: 'No token provided' });
  const idToken = auth.split('Bearer ')[1];
  try {
    const decoded = await admin.auth().verifyIdToken(idToken);
    req.user = { uid: decoded.uid, email: decoded.email };
    next();
  } catch (err) {
    console.error('Token verify error', err);
    res.status(401).json({ error: 'Invalid token' });
  }
}

// ---------- Helper: user paths ----------
function notesRef(uid) { return db.ref(`users/${uid}/notes`); }
function trashRef(uid) { return db.ref(`users/${uid}/trash`); }

// ---------- Notes endpoints (authenticated) ----------
app.get('/api/notes', verifyTokenMiddleware, async (req, res) => {
  try {
    const uid = req.user.uid;
    const snap = await notesRef(uid).once('value');
    const data = snap.val() || {};
    const arr = Object.keys(data).map(k => ({ id: k, ...data[k] }));
    res.json(arr);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/notes', verifyTokenMiddleware, async (req, res) => {
  try {
    const uid = req.user.uid;
    const note = {
      text: req.body.text || '',
      file: req.body.file || null,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    const ref = await notesRef(uid).push(note);
    res.json({ id: ref.key, ...note });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/notes/:id', verifyTokenMiddleware, async (req, res) => {
  try {
    const uid = req.user.uid;
    const id = req.params.id;
    const update = { ...req.body, updatedAt: Date.now() };
    await notesRef(uid).child(id).update(update);
    const snap = await notesRef(uid).child(id).once('value');
    res.json({ id, ...snap.val() });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Delete note -> move to user's trash
app.delete('/api/notes/:id', verifyTokenMiddleware, async (req, res) => {
  try {
    const uid = req.user.uid;
    const id = req.params.id;
    const snap = await notesRef(uid).child(id).once('value');
    const note = snap.val();
    if (!note) return res.status(404).json({ error: 'Note not found' });
    await trashRef(uid).push({ ...note, deletedAt: Date.now() });
    await notesRef(uid).child(id).remove();
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/trash', verifyTokenMiddleware, async (req, res) => {
  try {
    const uid = req.user.uid;
    const snap = await trashRef(uid).once('value');
    const data = snap.val() || {};
    const arr = Object.keys(data).map(k => ({ id: k, ...data[k] }));
    res.json(arr);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/trash/restore/:id', verifyTokenMiddleware, async (req, res) => {
  try {
    const uid = req.user.uid;
    const id = req.params.id;
    const snap = await trashRef(uid).child(id).once('value');
    const item = snap.val();
    if (!item) return res.status(404).json({ error: 'Trash item not found' });
    const newRef = await notesRef(uid).push(item);
    await trashRef(uid).child(id).remove();
    res.json({ id: newRef.key, ...item });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/trash/:id', verifyTokenMiddleware, async (req, res) => {
  try {
    const uid = req.user.uid;
    const id = req.params.id;
    await trashRef(uid).child(id).remove();
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ---------- File upload (PDF / images) ----------
app.post('/api/upload', verifyTokenMiddleware, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const localPath = req.file.path;
    const destination = `users/${req.user.uid}/notes/${uuidv4()}_${req.file.originalname}`;

    await bucket.upload(localPath, {
      destination,
      metadata: {
        contentType: req.file.mimetype,
        metadata: { firebaseStorageDownloadTokens: uuidv4() }
      }
    });

    fs.unlinkSync(localPath);
    const file = bucket.file(destination);
    const [url] = await file.getSignedUrl({ action: 'read', expires: '03-09-2491' });

    res.json({
      name: req.file.originalname,
      mime: req.file.mimetype,
      size: req.file.size,
      url
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Serve static frontend
app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const port = PORT || 3000;
app.listen(port, () => console.log(`Server running on http://localhost:${port}`));
