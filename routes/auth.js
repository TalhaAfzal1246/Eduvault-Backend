const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const ROLL_REGEX = /^(\d{2}[iklfp]-\d{4}|[iklfp]\d{2}-\d{4})$/i;

function generateToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN }
  );
}

router.post('/register', async (req, res) => {
  try {
    const { first_name, last_name, email, password, role, roll_number, department, phone } = req.body;

    if (!first_name || !last_name || !email || !password || !role)
      return res.status(400).json({ message: 'All fields are required.' });

    if (!email.endsWith('@nu.edu.pk'))
      return res.status(400).json({ message: 'Only @nu.edu.pk university emails are permitted.' });

    if (role === 'student') {
      if (!roll_number)
        return res.status(400).json({ message: 'Roll number is required for students.' });
      if (!ROLL_REGEX.test(roll_number))
        return res.status(400).json({ message: 'Invalid roll number format. Use formats like 24i-0027 or f22-1234.' });
    }
    if (role === 'teacher' && !department)
      return res.status(400).json({ message: 'Department is required for teachers.' });

    if (role === 'teacher') {
      if (!phone) return res.status(400).json({ message: 'Phone number is required for teachers.' });
      if (!/^03\d{2}-\d{7}$/.test(phone)) return res.status(400).json({ message: 'Phone number must be in format 03xx-xxxxxxx.' });
    }

    const [existing] = await db.query('SELECT id FROM users WHERE email = ?', [email]);
    if (existing.length > 0)
      return res.status(409).json({ message: 'An account with this email already exists.' });

    const hashedPassword = await bcrypt.hash(password, 10);

    // Teachers start as pending, students are active immediately
    const status = role === 'teacher' ? 'pending' : 'active';

    const [result] = await db.query(
      `INSERT INTO users (first_name, last_name, email, password, role, roll_number, department, phone, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [first_name, last_name, email, hashedPassword, role,
       role === 'student' ? roll_number : null,
       role === 'teacher' ? department : null,
       role === 'teacher' ? phone : null,
       status]
    );

    // Only return token for students (teachers must wait for approval)
    if (role === 'teacher') {
      return res.status(201).json({
        message: 'Teacher account submitted. Awaiting admin approval.',
        user: { id: result.insertId, name: first_name + ' ' + last_name, email, role, status: 'pending' }
      });
    }

    const token = generateToken({ id: result.insertId, email, role });

    res.status(201).json({
      message: 'Account created successfully.',
      token,
      user: { id: result.insertId, name: first_name + ' ' + last_name, email, role }
    });

  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ message: 'Server error. Please try again.' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password)
      return res.status(400).json({ message: 'Email and password are required.' });

    if (!email.endsWith('@nu.edu.pk'))
      return res.status(400).json({ message: 'Only @nu.edu.pk university emails are permitted.' });

    const [rows] = await db.query('SELECT * FROM users WHERE email = ?', [email]);
    if (rows.length === 0)
      return res.status(401).json({ message: 'Invalid email or password.' });

    const user = rows[0];
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch)
      return res.status(401).json({ message: 'Invalid email or password.' });

    // Block pending/rejected accounts
    if (user.status === 'pending')
      return res.status(403).json({ message: 'Your account is pending admin approval. Please wait for a coordinator to verify your credentials.' });
    if (user.status === 'rejected')
      return res.status(403).json({ message: 'Your account registration was rejected. Please contact the administrator.' });

    const token = generateToken(user);

    res.json({
      message: 'Login successful.',
      token,
      user: { id: user.id, name: user.first_name + ' ' + user.last_name, email: user.email, role: user.role }
    });

  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ message: 'Server error. Please try again.' });
  }
});

module.exports = router;
