require('dotenv').config();

const express = require('express');
const router = express.Router();
const nodemailer = require('nodemailer');
const Meeting = require('../models/Meeting');

// GET /api/briefings - Fetch all saved meetings/briefings
router.get('/', async (req, res) => {
  try {
    const meetings = await Meeting.findAll({
      order: [['createdAt', 'DESC']],
    });
    res.json(meetings);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/briefings - Save meeting & send email to attendees
router.post('/', async (req, res) => {
  try {
    const { title, recipientEmail, agenda, scheduledAt } = req.body;

    const summaryText = `Pre-meeting briefing compiled for "${title}". Key focus: ${
      agenda || 'Align deliverables, review API integration, and discuss upcoming milestones.'
    }`;

    // 1. Save Meeting to SQLite DB
    const meeting = await Meeting.create({
      title: title || 'New Scheduled Meeting',
      recipientEmail: recipientEmail || 'attendee@company.com',
    });

    // 2. Dispatch Email Asynchronously
    if (recipientEmail) {
      // Re-initialize transporter dynamically to guarantee env vars are loaded
      const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
          user: process.env.EMAIL_USER,
          pass: process.env.EMAIL_PASS,
        },
      });

      const mailOptions = {
        from: `"Revora AI Assistant" <${process.env.EMAIL_USER}>`,
        to: recipientEmail,
        subject: `[Pre-Meeting Briefing] ${meeting.title}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 12px;">
            <h2 style="color: #0084FF; margin-top: 0;">Revora AI Pre-Meeting Intelligence Brief</h2>
            <p style="font-size: 14px; color: #333;"><strong>Meeting:</strong> ${meeting.title}</p>
            <p style="font-size: 14px; color: #333;"><strong>Scheduled Time:</strong> ${
              scheduledAt ? new Date(scheduledAt).toLocaleString() : 'Upcoming'
            }</p>
            <hr style="border: none; border-top: 1px solid #eee; margin: 15px 0;" />
            <h3 style="font-size: 14px; color: #111;">AI Briefing Summary:</h3>
            <p style="background: #f4f8ff; padding: 12px; border-radius: 8px; font-size: 13px; color: #333; line-height: 1.5;">
              ${summaryText}
            </p>
            <h3 style="font-size: 14px; color: #111;">Key Topics & Action Items:</h3>
            <ul style="font-size: 13px; color: #444; padding-left: 20px;">
              <li>Architecture & Performance Sync</li>
              <li>API Endpoint Alignment</li>
              <li>Deliverable Status & Blockers</li>
            </ul>
            <p style="font-size: 11px; color: #888; margin-top: 20px;">Automated by Revora AI Assistant Agent.</p>
          </div>
        `,
      };

      transporter.sendMail(mailOptions, (mailErr, info) => {
        if (mailErr) {
          console.warn('⚠️ Nodemailer dispatch error:', mailErr.message);
        } else {
          console.log('✅ Briefing email successfully dispatched:', info.response);
        }
      });
    }

    res.status(201).json({
      ...meeting.toJSON(),
      summaryContext: summaryText,
      status: 'Sent & Ready',
    });
  } catch (error) {
    console.error('Error in POST /api/briefings:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;