const express = require('express');
const cors = require('cors');
const sequelize = require('./db');
const briefingRoutes = require('./routes/briefings');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// Routes
app.use('/api/meetings', briefingRoutes);

// Sync database and start server
sequelize.sync({ force: false }).then(() => {
  console.log('SQLite database synced.');
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}).catch(err => {
  console.error('Database connection failed:', err);
});