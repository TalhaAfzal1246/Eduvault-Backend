const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const db = require('../db');
const authenticateToken = require('../middleware/auth');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

// ─── Multer setup ──────────────────────────────────────────
const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + file.originalname.replace(/\s+/g, '_');
    cb(null, unique);
  }
});

const fileFilter = (req, file, cb) => {
  const allowed = ['.pdf', '.doc', '.docx', '.ppt', '.pptx'];
  const ext = path.extname(file.originalname).toLowerCase();
  if (allowed.includes(ext)) cb(null, true);
  else cb(new Error('Unsupported file type. Only PDF, DOC, DOCX, PPT, PPTX allowed.'));
};

const upload = multer({ storage, fileFilter, limits: { fileSize: 50 * 1024 * 1024 } });

// ─── POST /api/resources/upload ───────────────────────────
router.post('/upload', (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ message: 'Access denied. Please log in.' });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(403).json({ message: 'Session expired. Please log in again.' });
  }
}, (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (err instanceof multer.MulterError) return res.status(400).json({ message: `Upload error: ${err.message}` });
    else if (err) return res.status(400).json({ message: err.message });
    next();
  });
}, async (req, res) => {
  try {
    const { title, description, subject, topic } = req.body;
    if (!title || !description || !subject || !topic) {
      if (req.file) fs.unlinkSync(req.file.path);
      return res.status(400).json({ message: 'Title, description, subject, and topic are all required.' });
    }
    if (!req.file) return res.status(400).json({ message: 'Please select a file to upload.' });

    const uploader_id = req.user.id;
    const ext = path.extname(req.file.originalname).toUpperCase().replace('.', '');
    const fileSizeMB = (req.file.size / (1024 * 1024)).toFixed(2) + ' MB';

    // Teachers' uploads are auto-approved; students' uploads go to pending
    const [userRows] = await db.query('SELECT role FROM users WHERE id = ?', [uploader_id]);
    const uploaderRole = userRows.length > 0 ? userRows[0].role : 'student';
    const resourceStatus = uploaderRole === 'teacher' ? 'approved' : 'pending';

    const [result] = await db.query(
      `INSERT INTO resources (title, description, subject, topic, file_name, file_path, file_size, file_type, uploader_id, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [title, description, subject, topic, req.file.originalname, req.file.filename, fileSizeMB, ext, uploader_id, resourceStatus]
    );

    res.status(201).json({
      message: 'Resource uploaded successfully.',
      resource: { id: result.insertId, title, subject, topic, file_type: ext, file_size: fileSizeMB }
    });
  } catch (err) {
    if (req.file) fs.unlinkSync(req.file.path);
    console.error('Upload error:', err);
    res.status(500).json({ message: err.message || 'Upload failed. Please try again.' });
  }
});

// ─── GET /api/resources ───────────────────────────────────
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { subject, search } = req.query;
    let query = `
      SELECT r.id, r.title, r.description, r.subject, r.topic,
             r.file_size, r.file_type, r.download_count, r.created_at,
             r.status, r.rejection_reason,
             CONCAT(u.first_name, ' ', u.last_name) AS uploader_name,
             r.uploader_id
      FROM resources r
      JOIN users u ON r.uploader_id = u.id
      WHERE (r.status = 'approved' OR r.uploader_id = ?)
    `;
    const params = [req.user.id];
    if (subject) { query += ' AND r.subject = ?'; params.push(subject); }
    if (search) {
      query += ' AND (r.title LIKE ? OR r.description LIKE ? OR r.topic LIKE ?)';
      const like = `%${search}%`;
      params.push(like, like, like);
    }
    query += ' ORDER BY r.created_at DESC';
    const [rows] = await db.query(query, params);
    res.json({ resources: rows });
  } catch (err) {
    console.error('Fetch resources error:', err);
    res.status(500).json({ message: 'Could not fetch resources.' });
  }
});

// ─── GET /api/resources/:id ───────────────────────────────
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT r.*, CONCAT(u.first_name, ' ', u.last_name) AS uploader_name, u.email AS uploader_email
       FROM resources r JOIN users u ON r.uploader_id = u.id WHERE r.id = ?`,
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ message: 'Resource not found.' });
    res.json({ resource: rows[0] });
  } catch (err) {
    console.error('Fetch resource error:', err);
    res.status(500).json({ message: 'Could not fetch resource.' });
  }
});

// ─── GET /api/resources/:id/download ─────────────────────
router.get('/:id/download', async (req, res) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ message: 'Access denied. Please log in.' });

    let userId;
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      userId = decoded.id;
    } catch (e) {
      return res.status(403).json({ message: 'Session expired. Please log in again.' });
    }

    const [rows] = await db.query('SELECT * FROM resources WHERE id = ?', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ message: 'Resource not found.' });

    const resource = rows[0];
    const filePath = path.join(UPLOADS_DIR, resource.file_path);

    if (!fs.existsSync(filePath)) return res.status(404).json({ message: 'File no longer exists on the server.' });

    await db.query('INSERT INTO download_logs (resource_id, user_id) VALUES (?, ?)', [resource.id, userId]);
    await db.query('UPDATE resources SET download_count = download_count + 1 WHERE id = ?', [resource.id]);

    res.download(filePath, resource.file_name);
  } catch (err) {
    console.error('Download error:', err);
    res.status(500).json({ message: 'Download failed. Please try again.' });
  }
});

module.exports = router;
