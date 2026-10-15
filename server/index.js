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

// Sync database schema and start server
sequelize.sync({ alter: true }).then(() => {
  console.log('SQLite database synced.');
  startScheduler();
  console.log('Meeting reminder scheduler started.');
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}).catch(err => {
  console.error('Database connection failed:', err);
});