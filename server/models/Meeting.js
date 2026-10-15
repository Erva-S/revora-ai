const { DataTypes } = require('sequelize');
const sequelize = require('../db');

const Meeting = sequelize.define('Meeting', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  title: {
    type: DataTypes.STRING,
    allowNull: true
  },
  scheduledAt: {
    type: DataTypes.STRING,
    allowNull: true
  },
  startTime: {
    type: DataTypes.DATE,
    allowNull: true
  },
  recipientEmail: {
    type: DataTypes.STRING,
    allowNull: true
  },
  agenda: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  summaryContext: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  status: {
    type: DataTypes.STRING,
    allowNull: true
  }
});

module.exports = Meeting;