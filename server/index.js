require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const express = require('express');
const cors = require('cors');
const sequelize = require('./db');
const briefingRoutes = require('./routes/briefings');
const { startScheduler } = require('./scheduler');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// Briefings & Automated Meeting Email Dispatch
app.use('/api/briefings', briefingRoutes);
app.use('/briefings', briefingRoutes);

// Health check endpoint
app.get(['/api/health', '/health'], (req, res) => {
  res.json({ status: 'ok', service: 'server', timestamp: new Date().toISOString() });
});

// Task extraction endpoint
app.post(['/api/meetings/extract-tasks', '/meetings/extract-tasks'], async (req, res) => {
  const { transcript } = req.body || {};
  if (!transcript || typeof transcript !== 'string') {
    return res.status(400).json({ error: 'Transcript is required' });
  }
  const lines = transcript.split('\n');
  const taskLines = lines
    .filter(l => /todo|action|will do|follow up|assign|task|next step/i.test(l))
    .map(l => `- ${l.trim()}`);
  res.json({
    tasks: taskLines.length > 0
      ? taskLines.join('\n')
      : '- Review discussion notes and follow up with participants on key deliverables.'
  });
});

let isInitialized = false;
async function initializeApp() {
  if (isInitialized) return;
  try {
    await sequelize.sync({ alter: true });
    console.log('SQLite database synced.');
    startScheduler();
    console.log('Meeting reminder scheduler started.');
    isInitialized = true;
  } catch (err) {
    console.error('Database connection/sync failed:', err);
  }
}

// In standard Node / local dev, listen on PORT
if (!process.env.VERCEL) {
  initializeApp().then(() => {
    app.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  });
} else {
  // On Vercel serverless functions, initialize on first load
  initializeApp();
}

module.exports = app;