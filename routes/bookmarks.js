const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const db = require('../db');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

// Helper - decode token inline
function getUserId(req, res) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) { res.status(401).json({ message: 'Access denied. Please log in.' }); return null; }
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    return decoded.id;
  } catch (e) {
    res.status(403).json({ message: 'Session expired. Please log in again.' });
    return null;
  }
}

// ─── POST /api/bookmarks/:resourceId ──────────────────────
router.post('/:resourceId', async (req, res) => {
  try {
    const userId = getUserId(req, res);
    if (!userId) return;
    const [resource] = await db.query('SELECT id FROM resources WHERE id = ?', [req.params.resourceId]);
    if (resource.length === 0) return res.status(404).json({ message: 'Resource not found.' });
    await db.query('INSERT IGNORE INTO bookmarks (user_id, resource_id) VALUES (?, ?)', [userId, req.params.resourceId]);
    res.status(201).json({ message: 'Bookmarked successfully.' });
  } catch (err) {
    console.error('Bookmark add error:', err);
    res.status(500).json({ message: 'Could not bookmark resource.' });
  }
});

// ─── DELETE /api/bookmarks/:resourceId ────────────────────
router.delete('/:resourceId', async (req, res) => {
  try {
    const userId = getUserId(req, res);
    if (!userId) return;
    await db.query('DELETE FROM bookmarks WHERE user_id = ? AND resource_id = ?', [userId, req.params.resourceId]);
    res.json({ message: 'Bookmark removed.' });
  } catch (err) {
    console.error('Bookmark remove error:', err);
    res.status(500).json({ message: 'Could not remove bookmark.' });
  }
});

// ─── GET /api/bookmarks ───────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const userId = getUserId(req, res);
    if (!userId) return;
    const [rows] = await db.query(
      `SELECT r.id, r.title, r.description, r.subject, r.topic,
              r.file_size, r.file_type, r.download_count, r.created_at,
              CONCAT(u.first_name, ' ', u.last_name) AS uploader_name,
              b.created_at AS bookmarked_at
       FROM bookmarks b
       JOIN resources r ON b.resource_id = r.id
       JOIN users u ON r.uploader_id = u.id
       WHERE b.user_id = ?
       ORDER BY b.created_at DESC`,
      [userId]
    );
    res.json({ bookmarks: rows });
  } catch (err) {
    console.error('Fetch bookmarks error:', err);
    res.status(500).json({ message: 'Could not fetch bookmarks.' });
  }
});

// ─── GET /api/bookmarks/check/:resourceId ─────────────────
router.get('/check/:resourceId', async (req, res) => {
  try {
    const userId = getUserId(req, res);
    if (!userId) return;
    const [rows] = await db.query(
      'SELECT id FROM bookmarks WHERE user_id = ? AND resource_id = ?',
      [userId, req.params.resourceId]
    );
    res.json({ bookmarked: rows.length > 0 });
  } catch (err) {
    console.error('Check bookmark error:', err);
    res.status(500).json({ message: 'Could not check bookmark.' });
  }
});

module.exports = router;
