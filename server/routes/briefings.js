const express = require('express');
const router = express.Router();
const Meeting = require('../models/Meeting');

// POST /api/meetings - Create a new meeting
router.post('/', async (req, res) => {
  try {
    const { title, recipientEmail } = req.body;
    const meeting = await Meeting.create({
      title: title || 'New Meeting',
      recipientEmail: recipientEmail || 'attendee@company.com'
    });
    res.status(201).json(meeting);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/meetings/:id/briefing - Get pre-meeting briefing
router.get('/:id/briefing', async (req, res) => {
  try {
    const { id } = req.params;
    const meeting = await Meeting.findByPk(id);

    if (!meeting) {
      return res.status(404).json({ error: "Meeting not found in database" });
    }

    const preMeetingBriefing = {
      meetingId: meeting.id,
      title: meeting.title,
      recipientEmail: meeting.recipientEmail,
      summaryContext: `Pre-meeting briefing for "${meeting.title}". Key objective: align deliverables and review task status.`,
      keyTopics: ['Project Status Review', 'Task Assignments', 'Blockers & Risks'],
      status: 'Ready'
    };

    res.json(preMeetingBriefing);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;