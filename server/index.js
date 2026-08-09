require('dotenv').config();
const express = require('express');
const cors = require('cors');
const sequelize = require('./db');
const briefingRoutes = require('./routes/briefings');
const Meeting = require('./models/Meeting');
const { startScheduler } = require('./scheduler');
const { generateBriefing } = require('./aiService');

const app = express();
const PORT = process.env.PORT || 5000; // Set strictly to 5000

app.use(cors());
app.use(express.json());

// Routes
app.use('/api/meetings', briefingRoutes);

// Sync database and start server
sequelize.sync({ force: false }).then(async () => {
  console.log('SQLite database synced.');

  app.post('/api/briefing', async (req, res) => {
    try {
      const { meetingTitle, details } = req.body;
      const briefing = await generateBriefing(meetingTitle, details);
      res.json({ briefing });
    } catch (error) {
      console.error('Briefing route error:', error);
      res.status(500).json({ error: 'Failed to generate briefing' });
    }
  });

  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    startScheduler();
  });
}).catch(err => {
  console.error('Database connection failed:', err);
});