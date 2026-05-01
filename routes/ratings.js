const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const db = require('../db');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

function getUserId(req, res) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) { res.status(401).json({ message: 'Access denied.' }); return null; }
  try {
    return jwt.verify(token, process.env.JWT_SECRET).id;
  } catch (e) {
    res.status(403).json({ message: 'Session expired.' }); return null;
  }
}

// ─── POST /api/ratings/:resourceId ────────────────────────
// Submit or update a rating (1-5)
router.post('/:resourceId', async (req, res) => {
  try {
    const userId = getUserId(req, res);
    if (!userId) return;

    const { rating } = req.body;
    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({ message: 'Rating must be between 1 and 5.' });
    }

    // Check resource exists and is approved
    const [resource] = await db.query(
      "SELECT id FROM resources WHERE id = ? AND status = 'approved'",
      [req.params.resourceId]
    );
    if (resource.length === 0) {
      return res.status(404).json({ message: 'Resource not found.' });
    }

    // Insert or update rating (one rating per user per resource)
    await db.query(
      `INSERT INTO ratings (user_id, resource_id, rating)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE rating = ?, updated_at = CURRENT_TIMESTAMP`,
      [userId, req.params.resourceId, rating, rating]
    );

    // Return updated average
    const [[{ avg_rating, total_ratings }]] = await db.query(
      'SELECT ROUND(AVG(rating), 1) as avg_rating, COUNT(*) as total_ratings FROM ratings WHERE resource_id = ?',
      [req.params.resourceId]
    );

    res.json({ message: 'Rating submitted.', avg_rating, total_ratings });

  } catch (err) {
    console.error('Rating error:', err);
    res.status(500).json({ message: 'Could not submit rating.' });
  }
});

// ─── GET /api/ratings/:resourceId ─────────────────────────
// Get average rating + user's own rating
router.get('/:resourceId', async (req, res) => {
  try {
    const userId = getUserId(req, res);
    if (!userId) return;

    const [[{ avg_rating, total_ratings }]] = await db.query(
      'SELECT ROUND(AVG(rating), 1) as avg_rating, COUNT(*) as total_ratings FROM ratings WHERE resource_id = ?',
      [req.params.resourceId]
    );

    const [userRating] = await db.query(
      'SELECT rating FROM ratings WHERE user_id = ? AND resource_id = ?',
      [userId, req.params.resourceId]
    );

    res.json({
      avg_rating: avg_rating || 0,
      total_ratings,
      user_rating: userRating.length > 0 ? userRating[0].rating : null
    });

  } catch (err) {
    console.error('Get rating error:', err);
    res.status(500).json({ message: 'Could not fetch rating.' });
  }
});

module.exports = router;
