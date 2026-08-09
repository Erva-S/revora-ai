const express = require('express');
const router = express.Router();
const Meeting = require('../models/Meeting');
const { generateBriefing, extractTasksFromTranscript } = require('../aiService');
const { sendPreMeetingBriefing } = require('../emailService');

// 1. Admin creates a scheduled meeting
router.post('/', async (req, res) => {
  try {
    const { title, recipientEmail, details, scheduledAt } = req.body;

    if (!scheduledAt) {
      return res.status(400).json({ error: 'Meeting date and time (scheduledAt) is required' });
    }

    const meetingDate = new Date(scheduledAt);
    const now = new Date();
    const oneHourFromNow = new Date(now.getTime() + 60 * 60 * 1000);

    // Pre-generate the AI briefing text immediately
    const aiBriefingText = await generateBriefing(title || 'New Meeting', details || '');

    // Check if meeting is starting within 1 hour (or already in the past)
    const shouldPublishNow = meetingDate <= oneHourFromNow;

    // Save meeting record
    const meeting = await Meeting.create({
      title: title || 'New Meeting',
      recipientEmail: recipientEmail ? recipientEmail.trim().toLowerCase() : '',
      details: details || '',
      briefingText: aiBriefingText,
      scheduledAt: meetingDate,
      isPublished: shouldPublishNow
    });

    // If meeting is starting within 1 hour, send email right away
    if (shouldPublishNow) {
      const emailList = (recipientEmail || '')
        .split(',')
        .map(e => e.trim().toLowerCase())
        .filter(e => e.length > 0);

      for (const email of emailList) {
        await sendPreMeetingBriefing(email, meeting.title, aiBriefingText);
      }
    }

    res.status(201).json({ meeting, publishedNow: shouldPublishNow });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 2. Fetch published AI briefing specific to logged-in user
router.get('/user-briefing', async (req, res) => {
  try {
    const userEmail = req.query.email ? req.query.email.trim().toLowerCase() : '';

    if (!userEmail) {
      return res.status(400).json({ error: "User email is required" });
    }

    // Only query meetings marked as published (or within 1 hour of scheduledAt)
    const meetings = await Meeting.findAll({
      where: { isPublished: true },
      order: [['scheduledAt', 'DESC']]
    });

    const matchingMeeting = meetings.find(m => {
      if (!m.recipientEmail) return false;
      const recipients = m.recipientEmail.toLowerCase().split(',').map(e => e.trim());
      return recipients.includes(userEmail);
    });

    if (!matchingMeeting) {
      return res.status(404).json({ error: "No upcoming 1-hour meeting briefings available." });
    }

    res.json({
      meetingId: matchingMeeting.id,
      title: matchingMeeting.title,
      recipientEmail: matchingMeeting.recipientEmail,
      briefing: matchingMeeting.briefingText,
      scheduledAt: matchingMeeting.scheduledAt,
      status: 'Ready'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 3. Post-Meeting Task Extraction
router.post('/extract-tasks', async (req, res) => {
  try {
    const { transcript } = req.body;
    if (!transcript) {
      return res.status(400).json({ error: 'Transcript text is required' });
    }

    const tasksMarkdown = await extractTasksFromTranscript(transcript);
    res.json({ tasks: tasksMarkdown });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;