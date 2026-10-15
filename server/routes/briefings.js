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

    // Ensure scheduledAt is present in both camelCase and snake_case
    const formattedMeetings = meetings.map((m) => {
      const plain = m.toJSON();
      return {
        ...plain,
        scheduledAt: plain.scheduledAt || null,
        scheduled_at: plain.scheduledAt || null,
      };
    });

    res.json(formattedMeetings);
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

    // 1. Save Meeting with scheduledAt to Database
    const meeting = await Meeting.create({
      title: title || 'New Scheduled Meeting',
      recipientEmail: recipientEmail || 'attendee@company.com',
      agenda: agenda || '',
      scheduledAt: scheduledAt || null,
      summaryContext: summaryText,
      status: 'briefing_ready',
    });

    // 2. Dispatch Email to Attendees
    let emailStatus = { dispatched: false, error: null, previewUrl: null };
    const rawEmails = (recipientEmail || '').split(',').map((e) => e.trim()).filter(Boolean);

    if (rawEmails.length > 0) {
      try {
        let transporter;
        let senderEmail = 'assistant@revora.ai';

        const smtpHost = process.env.SMTP_HOST || (process.env.EMAIL_USER?.includes('@gmail.com') ? 'smtp.gmail.com' : null);
        const smtpPort = parseInt(process.env.SMTP_PORT || '587', 10);
        const smtpUser = process.env.SMTP_USER || process.env.EMAIL_USER;
        const smtpPass = process.env.SMTP_PASS || process.env.EMAIL_PASS;
        const smtpSecure = process.env.SMTP_SECURE === 'true' || smtpPort === 465;

        if (smtpUser && smtpPass) {
          transporter = nodemailer.createTransport({
            host: smtpHost || 'smtp.gmail.com',
            port: smtpPort,
            secure: smtpSecure,
            auth: {
              user: smtpUser,
              pass: smtpPass,
            },
            tls: {
              rejectUnauthorized: false,
            },
          });
          senderEmail = process.env.SMTP_FROM || `"Revora AI Assistant" <${smtpUser}>`;
        } else {
          // If live SMTP credentials are not configured yet, generate an Ethereal test mailer
          const testAccount = await nodemailer.createTestAccount();
          transporter = nodemailer.createTransport({
            host: 'smtp.ethereal.email',
            port: 587,
            secure: false,
            auth: {
              user: testAccount.user,
              pass: testAccount.pass,
            },
          });
          senderEmail = `"Revora AI Assistant" <${testAccount.user}>`;
        }

        const mailOptions = {
          from: senderEmail,
          to: rawEmails, // Array of all recipient attendee emails
          subject: `[Pre-Meeting Briefing] ${meeting.title}`,
          html: `
            <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 16px; background-color: #ffffff;">
              <div style="display: flex; align-items: center; margin-bottom: 20px;">
                <h2 style="color: #0084FF; margin: 0; font-size: 20px;">Revora AI — Pre-Meeting Intelligence Brief</h2>
              </div>
              <p style="font-size: 14px; color: #1e293b; margin: 6px 0;"><strong>Meeting:</strong> ${meeting.title}</p>
              <p style="font-size: 14px; color: #1e293b; margin: 6px 0;"><strong>Scheduled Time:</strong> ${
                scheduledAt ? new Date(scheduledAt).toLocaleString() : 'Upcoming'
              }</p>
              <p style="font-size: 14px; color: #1e293b; margin: 6px 0;"><strong>Attendees:</strong> ${rawEmails.join(', ')}</p>
              <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 16px 0;" />
              <h3 style="font-size: 14px; color: #0f172a; margin-bottom: 8px;">AI Context & Agenda Overview:</h3>
              <div style="background: #f0f7ff; padding: 14px; border-radius: 10px; font-size: 13px; color: #1e293b; line-height: 1.6; border: 1px solid #bae6fd;">
                ${agenda || summaryText}
              </div>
              <h3 style="font-size: 14px; color: #0f172a; margin-top: 16px; margin-bottom: 8px;">Automated Objectives:</h3>
              <ul style="font-size: 13px; color: #334155; padding-left: 20px; line-height: 1.6;">
                <li>Real-time transcription and speaker diarization via Revora AI</li>
                <li>Automated action item and decision tracking</li>
                <li>Post-meeting executive summary delivery</li>
              </ul>
              <p style="font-size: 11px; color: #94a3b8; margin-top: 24px; border-top: 1px solid #f1f5f9; padding-top: 12px;">
                Automated by Revora AI Meeting Assistant Agent.
              </p>
            </div>
          `,
        };

        const info = await transporter.sendMail(mailOptions);
        const testUrl = nodemailer.getTestMessageUrl(info);
        console.log('✅ Briefing email successfully dispatched to:', rawEmails.join(', '));
        if (testUrl) {
          console.log('🔗 Email preview URL (Ethereal test mode):', testUrl);
        }

        emailStatus = {
          dispatched: true,
          previewUrl: testUrl || null,
          recipients: rawEmails,
        };
      } catch (mailErr) {
        console.warn('⚠️ Email dispatch notice:', mailErr.message);
        emailStatus = { dispatched: false, error: mailErr.message };
      }
    }

    res.status(201).json({
      ...meeting.toJSON(),
      scheduledAt: meeting.scheduledAt,
      scheduled_at: meeting.scheduledAt,
      summaryContext: summaryText,
      emailStatus,
      status: 'Sent & Ready',
    });
  } catch (error) {
    console.error('Error in POST /api/briefings:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;