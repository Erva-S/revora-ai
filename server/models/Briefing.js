const express = require('express');
const router = express.Router();
const Meeting = require('../models/Meeting');
const { generateBriefing } = require('../aiService');

// POST /api/meetings - Create a new meeting
router.post('/', async (req, res) => {
  try {
    const { title, recipientEmail, details } = req.body;
    const meeting = await Meeting.create({
      title: title || 'New Meeting',
      recipientEmail: recipientEmail || 'attendee@company.com',
      details: details || ''
    });
    res.status(201).json(meeting);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/meetings/:id/briefing - Get cached briefing or generate & save
router.get('/:id/briefing', async (req, res) => {
  try {
    const { id } = req.params;
    const meeting = await Meeting.findByPk(id);

    if (!meeting) {
      return res.status(404).json({ error: "Meeting not found in database" });
    }

    // Return stored briefing if it exists
    if (meeting.briefingText && meeting.briefingText.trim().length > 0) {
      return res.json({
        meetingId: meeting.id,
        title: meeting.title,
        recipientEmail: meeting.recipientEmail,
        briefing: meeting.briefingText,
        status: 'Ready'
      });
    }

    // Generate once via Gemini AI if missing, then save to database
    const aiBriefingText = await generateBriefing(meeting.title, meeting.details || '');
    
    meeting.briefingText = aiBriefingText;
    await meeting.save();

    res.json({
      meetingId: meeting.id,
      title: meeting.title,
      recipientEmail: meeting.recipientEmail,
      briefing: aiBriefingText,
      status: 'Ready'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;