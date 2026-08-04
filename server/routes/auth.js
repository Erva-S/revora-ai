const express = require('express');
const passport = require('passport');
const bcrypt = require('bcryptjs');
const User = require('../models/User');

const router = express.Router();

// Helper middleware for protecting routes
const ensureAuthenticated = (req, res, next) => {
  if (req.isAuthenticated()) return next();
  return res.status(401).json({ success: false, message: 'Unauthorized. Session expired or missing.' });
};

const ensureAdmin = (req, res, next) => {
  if (req.isAuthenticated() && req.user.role === 'admin') return next();
  return res.status(403).json({ success: false, message: 'Forbidden. Admin credentials required.' });
};

// --- AUTH ENDPOINTS ---

// Admin Local Login endpoint
router.post('/auth/admin/login', (req, res, next) => {
  passport.authenticate('admin-local', (err, user, info) => {
    if (err) return next(err);
    if (!user) {
      return res.status(401).json({ success: false, message: info?.message || 'Invalid admin credentials' });
    }
    req.logIn(user, (err) => {
      if (err) return next(err);
      return res.json({
        success: true,
        message: 'Admin authenticated successfully',
        user: {
          id: user.id,
          email: user.email,
          name: user.name || 'Admin',
          role: user.role,
          avatar: user.avatar,
        },
      });
    });
  })(req, res, next);
});

// Google OAuth Login Trigger
router.get('/auth/google', (req, res, next) => {
  if (!process.env.GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID === 'MOCK_GOOGLE_CLIENT_ID') {
    // If real Google Client ID is missing, redirect to demo google login helper
    return res.redirect('/auth/demo-google-login');
  }
  passport.authenticate('google', { scope: ['profile', 'email'] })(req, res, next);
});

// Google OAuth Callback
router.get(
  '/auth/google/callback',
  passport.authenticate('google', { failureRedirect: '/login?error=google_failed' }),
  (req, res) => {
    const clientUrl = process.env.CLIENT_URL || 'http://localhost:5173';
    res.redirect(`${clientUrl}/dashboard`);
  }
);

// Demo Google Login Fallback (For local testing without Google API Keys)
router.get('/auth/demo-google-login', async (req, res) => {
  try {
    const demoEmail = 'alex.user@assist.ai';
    let user = await User.findOne({ where: { email: demoEmail } });
    if (!user) {
      user = await User.create({
        googleId: 'google_demo_10928374',
        email: demoEmail,
        name: 'Alex Rivera',
        avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&h=100&fit=crop&crop=face',
        role: 'user',
      });
    }
    req.logIn(user, (err) => {
      const clientUrl = process.env.CLIENT_URL || 'http://localhost:5173';
      return res.redirect(`${clientUrl}/dashboard`);
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Demo User Direct JSON Login
router.post('/auth/demo-user-login', async (req, res) => {
  try {
    const demoEmail = 'alex.user@assist.ai';
    let user = await User.findOne({ where: { email: demoEmail } });
    if (!user) {
      user = await User.create({
        googleId: 'google_demo_10928374',
        email: demoEmail,
        name: 'Alex Rivera',
        avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&h=100&fit=crop&crop=face',
        role: 'user',
      });
    }
    req.logIn(user, (err) => {
      if (err) return res.status(500).json({ success: false, message: 'Session login failed' });
      return res.json({
        success: true,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          avatar: user.avatar,
        },
      });
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Check Session / Current User
router.get('/auth/me', (req, res) => {
  if (req.isAuthenticated() && req.user) {
    return res.json({
      authenticated: true,
      user: req.user,
    });
  }
  return res.json({
    authenticated: false,
    user: null,
  });
});

// Logout Endpoint
router.post('/auth/logout', (req, res) => {
  req.logout((err) => {
    if (err) return res.status(500).json({ success: false, message: 'Logout failed' });
    req.session.destroy(() => {
      res.clearCookie('connect.sid');
      return res.json({ success: true, message: 'Logged out successfully' });
    });
  });
});

// --- ADMIN API ENDPOINTS ---

// Admin: Get all users
router.get('/api/users', ensureAdmin, async (req, res) => {
  try {
    const users = await User.findAll({
      attributes: ['id', 'email', 'name', 'role', 'avatar', 'googleId', 'createdAt'],
      order: [['createdAt', 'DESC']],
    });
    res.json({ success: true, users });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Admin: Toggle / Update User Role
router.patch('/api/users/:id/role', ensureAdmin, async (req, res) => {
  try {
    const { role } = req.body;
    if (!['user', 'admin'].includes(role)) {
      return res.status(400).json({ success: false, message: 'Invalid role value' });
    }
    const user = await User.findByPk(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    
    user.role = role;
    await user.save();
    res.json({ success: true, user: { id: user.id, email: user.email, role: user.role } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Admin: Delete User
router.delete('/api/users/:id', ensureAdmin, async (req, res) => {
  try {
    const user = await User.findByPk(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    if (user.id === req.user.id) {
      return res.status(400).json({ success: false, message: 'Cannot delete your own active admin account' });
    }
    await user.destroy();
    res.json({ success: true, message: 'User deleted successfully' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
