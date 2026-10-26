const sequelize = require('./db');

async function syncDatabase() {
  try {
    await sequelize.sync();
    console.log('Database synced cleanly without dummy records.');
    process.exit(0);
  } catch (error) {
    console.error('Failed to sync database:', error);
    process.exit(1);
  }
}

syncDatabase();