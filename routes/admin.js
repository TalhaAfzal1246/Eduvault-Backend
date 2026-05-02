const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

// ─── Helper: decode token inline ──────────────────────────
function getUserFromToken(req, res) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) { res.status(401).json({ message: 'Access denied. Please log in.' }); return null; }
  try {
    return jwt.verify(token, process.env.JWT_SECRET);
  } catch (e) {
    res.status(403).json({ message: 'Session expired. Please log in again.' });
    return null;
  }
}

// ─── Helper: verify admin role ─────────────────────────────
function requireAdmin(req, res) {
  const user = getUserFromToken(req, res);
  if (!user) return null;
  if (user.role !== 'admin') {
    res.status(403).json({ message: 'Access denied. Admin only.' });
    return null;
  }
  return user;
}

// ─── POST /api/admin/register ──────────────────────────────
// Hidden registration for admins
router.post('/register', async (req, res) => {
  try {
    const { first_name, last_name, email, password, assigned_subject, secret_key } = req.body;

    // Secret key check — only people who know this can create admin accounts
    if (secret_key !== process.env.ADMIN_SECRET_KEY) {
      return res.status(403).json({ message: 'Invalid secret key.' });
    }

    if (!first_name || !last_name || !email || !password || !assigned_subject) {
      return res.status(400).json({ message: 'All fields are required.' });
    }

    if (!email.endsWith('@nu.edu.pk')) {
      return res.status(400).json({ message: 'Only @nu.edu.pk emails are permitted.' });
    }

    const [existing] = await db.query('SELECT id FROM users WHERE email = ?', [email]);
    if (existing.length > 0) {
      return res.status(409).json({ message: 'An account with this email already exists.' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const [result] = await db.query(
      `INSERT INTO users (first_name, last_name, email, password, role, status, assigned_subject)
       VALUES (?, ?, ?, ?, 'admin', 'active', ?)`,
      [first_name, last_name, email, hashedPassword, assigned_subject]
    );

    res.status(201).json({
      message: 'Admin account created successfully.',
      admin: { id: result.insertId, first_name, last_name, email, assigned_subject }
    });

  } catch (err) {
    console.error('Admin register error:', err);
    res.status(500).json({ message: 'Server error. Please try again.' });
  }
});

// ─── POST /api/admin/login ─────────────────────────────────
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required.' });
    }

    const [rows] = await db.query(
      "SELECT * FROM users WHERE email = ? AND role = 'admin'",
      [email]
    );

    if (rows.length === 0) {
      return res.status(401).json({ message: 'Invalid credentials or not an admin account.' });
    }

    const admin = rows[0];
    const isMatch = await bcrypt.compare(password, admin.password);
    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid credentials.' });
    }

    const token = jwt.sign(
      { id: admin.id, email: admin.email, role: 'admin', assigned_subject: admin.assigned_subject },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({
      message: 'Login successful.',
      token,
      admin: {
        id: admin.id,
        name: admin.first_name + ' ' + admin.last_name,
        email: admin.email,
        assigned_subject: admin.assigned_subject
      }
    });

  } catch (err) {
    console.error('Admin login error:', err);
    res.status(500).json({ message: 'Server error. Please try again.' });
  }
});

// ─── GET /api/admin/stats ──────────────────────────────────
router.get('/stats', async (req, res) => {
  try {
    const admin = requireAdmin(req, res);
    if (!admin) return;

    const subject = admin.assigned_subject;

    const [[{ totalResources }]] = await db.query(
      "SELECT COUNT(*) as totalResources FROM resources WHERE subject = ? AND status = 'approved'",
      [subject]
    );
    const [[{ pendingResources }]] = await db.query(
      "SELECT COUNT(*) as pendingResources FROM resources WHERE subject = ? AND status = 'pending'",
      [subject]
    );
    const [[{ totalDownloads }]] = await db.query(
      "SELECT COALESCE(SUM(download_count), 0) as totalDownloads FROM resources WHERE subject = ?",
      [subject]
    );
    const [[{ pendingTeachers }]] = await db.query(
      "SELECT COUNT(*) as pendingTeachers FROM users WHERE role = 'teacher' AND status = 'pending'"
    );
    const [[{ totalStudents }]] = await db.query(
      "SELECT COUNT(*) as totalStudents FROM users WHERE role = 'student' AND status = 'active'"
    );
    const [[{ totalTeachers }]] = await db.query(
      "SELECT COUNT(*) as totalTeachers FROM users WHERE role = 'teacher' AND status = 'active'"
    );

    res.json({
      stats: {
        totalResources,
        pendingResources,
        totalDownloads,
        pendingTeachers,
        totalStudents,
        totalTeachers,
        assignedSubject: subject
      }
    });

  } catch (err) {
    console.error('Stats error:', err);
    res.status(500).json({ message: 'Could not fetch stats.' });
  }
});

// ─── GET /api/admin/pending-resources ─────────────────────
// Returns pending resources for admin's assigned subject
router.get('/pending-resources', async (req, res) => {
  try {
    const admin = requireAdmin(req, res);
    if (!admin) return;

    const [rows] = await db.query(
      `SELECT r.id, r.title, r.description, r.subject, r.topic,
              r.file_name, r.file_path, r.file_size, r.file_type,
              r.created_at,
              CONCAT(u.first_name, ' ', u.last_name) AS uploader_name,
              u.email AS uploader_email, u.roll_number
       FROM resources r
       JOIN users u ON r.uploader_id = u.id
       WHERE r.status = 'pending' AND r.subject = ?
       ORDER BY r.created_at ASC`,
      [admin.assigned_subject]
    );

    res.json({ resources: rows });

  } catch (err) {
    console.error('Pending resources error:', err);
    res.status(500).json({ message: 'Could not fetch pending resources.' });
  }
});

// ─── POST /api/admin/resources/:id/approve ────────────────
router.post('/resources/:id/approve', async (req, res) => {
  try {
    const admin = requireAdmin(req, res);
    if (!admin) return;

    await db.query(
      "UPDATE resources SET status = 'approved', rejection_reason = NULL WHERE id = ? AND subject = ?",
      [req.params.id, admin.assigned_subject]
    );

    res.json({ message: 'Resource approved successfully.' });

  } catch (err) {
    console.error('Approve resource error:', err);
    res.status(500).json({ message: 'Could not approve resource.' });
  }
});

// ─── POST /api/admin/resources/:id/reject ─────────────────
router.post('/resources/:id/reject', async (req, res) => {
  try {
    const admin = requireAdmin(req, res);
    if (!admin) return;

    // 1. MUST pull 'subject' from req.body
    const { reason, subject } = req.body; 

    // 2. MUST use 'subject' in the query instead of 'admin.assigned_subject'
    await db.query(
      "UPDATE resources SET status = 'rejected', rejection_reason = ? WHERE id = ? AND subject = ?",
      [reason.trim(), req.params.id, subject] 
    );

    res.json({ message: 'Resource rejected.' });
  } catch (err) {
    res.status(500).send('Error');
  }
});
// router.post('/resources/:id/reject', async (req, res) => {
//   try {
//     const admin = requireAdmin(req, res);
//     if (!admin) return;

//     const { reason } = req.body;
//     if (!reason || !reason.trim()) {
//       return res.status(400).json({ message: 'Rejection reason is required.' });
//     }

//     await db.query(
//       "UPDATE resources SET status = 'rejected', rejection_reason = ? WHERE id = ? AND subject = ?",
//       [reason.trim(), req.params.id, admin.assigned_subject]
//     );

//     res.json({ message: 'Resource rejected.' });

//   } catch (err) {
//     console.error('Reject resource error:', err);
//     res.status(500).json({ message: 'Could not reject resource.' });
//   }
// });
// 1. Change POST to PUT (Standard for updates)
// 2. Add /api (if your other routes use it)
// router.put('/resources/:id/reject', async (req, res) => {
//   try {
//     const admin = requireAdmin(req, res);
//     if (!admin) return res.status(401).json({ message: 'Unauthorized' });

//     // Look for 'reason' OR 'rejection_reason' just in case
//     const reason = req.body.reason || req.body.rejection_reason;

//     if (!reason || !reason.trim()) {
//       return res.status(400).json({ message: 'Rejection reason is required.' });
//     }

//     // We'll use your exact working data match from the screenshots
//     const [result] = await db.query(
//       "UPDATE resources SET status = 'rejected', rejection_reason = ? WHERE id = ? AND subject = ?",
//       [reason.trim(), req.params.id, admin.assigned_subject]
//     );

//     if (result.affectedRows === 0) {
//       return res.status(404).json({ message: 'No matching resource found for your subject.' });
//     }

//     res.json({ message: 'Resource rejected successfully.' });
//   } catch (err) {
//     console.error('Reject resource error:', err);
//     res.status(500).json({ message: 'Server error during rejection.' });
//   }
// });

// ─── GET /api/admin/pending-teachers ──────────────────────
router.get('/pending-teachers', async (req, res) => {
  try {
    const admin = requireAdmin(req, res);
    if (!admin) return;

    const [rows] = await db.query(
      `SELECT id, first_name, last_name, email, phone, department, created_at
       FROM users
       WHERE role = 'teacher' AND status = 'pending'
       ORDER BY created_at ASC`
    );

    res.json({ teachers: rows });

  } catch (err) {
    console.error('Pending teachers error:', err);
    res.status(500).json({ message: 'Could not fetch pending teachers.' });
  }
});

// ─── POST /api/admin/teachers/:id/approve ─────────────────
router.post('/teachers/:id/approve', async (req, res) => {
  try {
    const admin = requireAdmin(req, res);
    if (!admin) return;

    await db.query(
      "UPDATE users SET status = 'active' WHERE id = ? AND role = 'teacher'",
      [req.params.id]
    );

    res.json({ message: 'Teacher account approved.' });

  } catch (err) {
    console.error('Approve teacher error:', err);
    res.status(500).json({ message: 'Could not approve teacher.' });
  }
});

// ─── POST /api/admin/teachers/:id/reject ──────────────────
router.post('/teachers/:id/reject', async (req, res) => {
  try {
    const admin = requireAdmin(req, res);
    if (!admin) return;

    await db.query(
      "UPDATE users SET status = 'rejected' WHERE id = ? AND role = 'teacher'",
      [req.params.id]
    );

    res.json({ message: 'Teacher account rejected.' });

  } catch (err) {
    console.error('Reject teacher error:', err);
    res.status(500).json({ message: 'Could not reject teacher.' });
  }
});

module.exports = router;
