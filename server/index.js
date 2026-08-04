require('dotenv').config();
const express = require('express');
const session = require('express-session');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const sequelize = require('./db');
const User = require('./models/User');
const passport = require('./config/passport');
const authRoutes = require('./routes/auth');

const app = express();
const PORT = process.env.PORT || 5000;

// CORS configuration for React Vite frontend
app.use(
  cors({
    origin: process.env.CLIENT_URL || 'http://localhost:5173',
    credentials: true,
  })
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Express Session configuration
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'futurrizon_super_secret_session_key_2026',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: false, // Set to true in production with HTTPS
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
    },
  })
);

// Initialize Passport & Sessions
app.use(passport.initialize());
app.use(passport.session());

// Mount Routes
app.use('/', authRoutes);

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'online',
    timestamp: new Date().toISOString(),
    database: 'SQLite connected',
    session: req.isAuthenticated() ? 'Active' : 'Guest',
  });
});

// Sync Database and Seed Admin User
async function startServer() {
  try {
    await sequelize.sync();
    console.log('✔ SQLite Database synced via Sequelize.');

    // Seed Default Admin User if not exists
    const adminEmail = 'admin@assist.ai';
    let admin = await User.findOne({ where: { email: adminEmail } });
    if (!admin) {
      const hashedPassword = bcrypt.hashSync('Admin@123', 10);
      admin = await User.create({
        email: adminEmail,
        password: hashedPassword,
        name: 'System Admin',
        role: 'admin',
        avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=100&h=100&fit=crop&crop=face',
      });
      console.log('★ Default Admin account seeded: admin@assist.ai / Admin@123');
    }

    // Seed Sample Standard User if not exists
    const userEmail = 'alex.user@assist.ai';
    let sampleUser = await User.findOne({ where: { email: userEmail } });
    if (!sampleUser) {
      sampleUser = await User.create({
        googleId: 'google_demo_10928374',
        email: userEmail,
        name: 'Alex Rivera',
        role: 'user',
        avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&h=100&fit=crop&crop=face',
      });
      console.log('★ Sample Standard User seeded: alex.user@assist.ai');
    }

    const server = app.listen(PORT, () => {
      console.log(`🚀 Node.js/Express Backend running on http://localhost:${PORT}`);
    });

    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.log(`⚠️ Port ${PORT} is already in use (the backend server is already running!). You can proceed directly to http://localhost:5173`);
      } else {
        console.error('❌ Server error:', err);
      }
    });
  } catch (err) {
    console.error('❌ Failed to start Express backend server:', err);
  }
}

startServer();
