const { Sequelize } = require('sequelize');
const path = require('path');
const fs = require('fs');

const isVercel = Boolean(process.env.VERCEL);
const defaultStorage = path.join(__dirname, 'database.sqlite');
let storage = process.env.SQLITE_STORAGE || defaultStorage;

if (isVercel && !process.env.SQLITE_STORAGE) {
  const os = require('os');
  const tmpStorage = path.join(os.tmpdir(), 'database.sqlite');
  try {
    if (!fs.existsSync(tmpStorage) && fs.existsSync(defaultStorage)) {
      fs.copyFileSync(defaultStorage, tmpStorage);
    }
    storage = tmpStorage;
  } catch (err) {
    console.warn('[db] Could not initialize sqlite in tmp directory:', err);
  }
}

const sequelize = new Sequelize({
  dialect: 'sqlite',
  storage,
  logging: false
});

module.exports = sequelize;