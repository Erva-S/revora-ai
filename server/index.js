const express = require('express');
const cors = require('cors');
const sequelize = require('./db');
const briefingRoutes = require('./routes/briefings');

const app = express();
const PORT = process.env.PORT || 5001;

app.use(cors());
app.use(express.json());

// Admin Authentication Route
app.post('/api/admin/login', (req, res) => {
  const { adminId, password } = req.body;
  
  const validId = process.env.ADMIN_ID || 'admin';
  const validPass = process.env.ADMIN_PASSWORD || 'SuperSecretPassword123!';

  if (adminId === validId && password === validPass) {
    return res.json({ success: true, token: 'revora-admin-authenticated' });
  } else {
    return res.status(401).json({ success: false, message: 'Invalid Admin ID or Password' });
  }
});

// Routes
app.use('/api/briefings', briefingRoutes);

// Sync database and start server
sequelize.sync({ force: false }).then(() => {
  console.log('SQLite database synced.');
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}).catch(err => {
  console.error('Database connection failed:', err);
});