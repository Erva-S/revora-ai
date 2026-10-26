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
  creatorEmail: {
    type: DataTypes.STRING,
    allowNull: true
  },
  creatorUserId: {
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
  },
  clientId: {
    type: DataTypes.STRING,
    allowNull: true
  },
  clientName: {
    type: DataTypes.STRING,
    allowNull: true
  },
  projectId: {
    type: DataTypes.STRING,
    allowNull: true
  },
  projectName: {
    type: DataTypes.STRING,
    allowNull: true
  },
  meetingUrl: {
    type: DataTypes.STRING,
    allowNull: true
  },
  summary: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  transcript: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  actionItems: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  reminderSent: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  resultsEmailSent: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  }
});

module.exports = Meeting;