require('dotenv').config();

const express = require('express');
const router = express.Router();
const nodemailer = require('nodemailer');
const Meeting = require('../models/Meeting');
const supabase = require('../supabase');

// GET /api/briefings - Fetch meetings/briefings authorized for caller
router.get('/', async (req, res) => {
  try {
    const userEmail = (req.headers['x-user-email'] || req.query.email || '').trim().toLowerCase();
    const userId = (req.headers['x-user-id'] || req.query.userId || '').trim();
    const userRole = (req.headers['x-user-role'] || req.query.role || '').trim().toLowerCase();
    const userClientId = (req.headers['x-client-id'] || req.query.clientId || '').trim();

    // If caller provides no identity, fail closed
    if (!userEmail && !userId) {
      return res.json([]);
    }

    const meetings = await Meeting.findAll({
      order: [['createdAt', 'DESC']],
    });

    const isAdmin = userRole === 'admin' || userEmail === 'evv18407@gmail.com';

    const visibleMeetings = isAdmin
      ? meetings
      : meetings.filter((m) => {
          // If caller is bound to a client, they MUST NOT see meetings belonging to another client
          if (userClientId && m.clientId && m.clientId !== userClientId) {
            return false;
          }

          // If meeting is explicitly assigned to caller's client, allow access
          if (userClientId && m.clientId && m.clientId === userClientId) {
            return true;
          }

          const creatorEmail = (m.creatorEmail || '').trim().toLowerCase();
          if (creatorEmail && creatorEmail === userEmail) return true;
          if (m.creatorUserId && m.creatorUserId === userId) return true;

          const recipients = (m.recipientEmail || '')
            .split(',')
            .map((e) => e.trim().toLowerCase())
            .filter(Boolean);
          return recipients.includes(userEmail);
        });

    // Ensure scheduledAt and client/project identifiers are returned consistently
    const formattedMeetings = visibleMeetings.map((m) => {
      const plain = m.toJSON();
      return {
        ...plain,
        scheduledAt: plain.scheduledAt || null,
        scheduled_at: plain.scheduledAt || null,
        clientId: plain.clientId || null,
        client_id: plain.clientId || null,
        clientName: plain.clientName || null,
        client_name: plain.clientName || null,
        projectId: plain.projectId || null,
        project_id: plain.projectId || null,
        projectName: plain.projectName || null,
        project_name: plain.projectName || null,
      };
    });

    res.json(formattedMeetings);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/briefings/:id - Fetch single meeting with strict authorization
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const userEmail = (req.headers['x-user-email'] || req.query.email || '').trim().toLowerCase();
    const userId = (req.headers['x-user-id'] || req.query.userId || '').trim();
    const userRole = (req.headers['x-user-role'] || req.query.role || '').trim().toLowerCase();
    const userClientId = (req.headers['x-client-id'] || req.query.clientId || '').trim();

    const meeting = await Meeting.findByPk(id);
    if (!meeting) {
      return res.status(404).json({ error: 'Meeting not found.' });
    }

    const isAdmin = userRole === 'admin' || userEmail === 'evv18407@gmail.com';

    // Strict multi-tenant isolation: client users must never view other clients' meetings
    if (!isAdmin && userClientId && meeting.clientId && meeting.clientId !== userClientId) {
      return res.status(403).json({ error: 'Access denied: You are not authorized to view meetings belonging to another client.' });
    }

    const creatorEmail = (meeting.creatorEmail || '').trim().toLowerCase();
    const isCreator = (creatorEmail && creatorEmail === userEmail) || (meeting.creatorUserId && meeting.creatorUserId === userId);
    const recipients = (meeting.recipientEmail || '')
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);
    const isAttendee = recipients.includes(userEmail);
    const isClientOwner = Boolean(userClientId && meeting.clientId && meeting.clientId === userClientId);

    if (!isAdmin && !isCreator && !isAttendee && !isClientOwner) {
      return res.status(403).json({ error: 'Access denied: You are not authorized to view this meeting.' });
    }

    const plain = meeting.toJSON();
    res.json({
      ...plain,
      scheduledAt: plain.scheduledAt || null,
      scheduled_at: plain.scheduledAt || null,
      clientId: plain.clientId || null,
      client_id: plain.clientId || null,
      clientName: plain.clientName || null,
      client_name: plain.clientName || null,
      projectId: plain.projectId || null,
      project_id: plain.projectId || null,
      projectName: plain.projectName || null,
      project_name: plain.projectName || null,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/briefings - Save meeting & send email to attendees
router.post('/', async (req, res) => {
  try {
    const { 
      title, 
      recipientEmail, 
      agenda, 
      scheduledAt, 
      creatorEmail, 
      creatorUserId,
      clientId: bodyClientId,
      client_id: bodyClient_id,
      projectId: bodyProjectId,
      project_id: bodyProject_id,
    } = req.body;

    const authorEmail = (creatorEmail || req.headers['x-user-email'] || '').trim().toLowerCase();
    const authorUserId = creatorUserId || req.headers['x-user-id'] || null;
    const userRole = (req.headers['x-user-role'] || '').trim().toLowerCase();

    // 1. Enforce Server-Side Admin Authorization
    const isAdmin = userRole === 'admin' || authorEmail === 'evv18407@gmail.com';
    if (!isAdmin) {
      return res.status(403).json({ error: 'Access denied: Only administrators can schedule meetings.' });
    }

    // 2. Validate Client and Project selection
    const clientId = bodyClientId || bodyClient_id;
    const projectId = bodyProjectId || bodyProject_id;

    if (!clientId) {
      return res.status(400).json({ error: 'Client selection is required. Please select a client before scheduling.' });
    }

    if (!projectId) {
      return res.status(400).json({ error: 'Project selection is required. Please select a project belonging to the selected client.' });
    }

    // 3. Server-side validation against database records
    const { data: validation, error: rpcError } = await supabase.rpc('validate_meeting_client_project', {
      p_client_id: clientId,
      p_project_id: projectId,
    });

    if (rpcError) {
      console.error('[POST /api/briefings] Validation RPC error:', rpcError);
      return res.status(500).json({ error: 'Failed to verify client and project relationships.' });
    }

    if (!validation || !validation.valid) {
      return res.status(400).json({ 
        error: validation?.error || 'Invalid client or project selection.' 
      });
    }

    const { 
      client_name: clientName, 
      project_name: projectName, 
      client_id: verifiedClientId, 
      project_id: verifiedProjectId 
    } = validation;

    const summaryText = `Pre-meeting briefing compiled for "${title || 'New Scheduled Meeting'}". Client: ${clientName} | Project: ${projectName}. Key focus: ${
      agenda || 'Align deliverables, review API integration, and discuss upcoming milestones.'
    }`;

    // 4. Save Meeting with verified relationships in SQLite
    const meeting = await Meeting.create({
      title: title || 'New Scheduled Meeting',
      recipientEmail: recipientEmail || 'attendee@company.com',
      creatorEmail: authorEmail || null,
      creatorUserId: authorUserId || null,
      agenda: agenda || '',
      scheduledAt: scheduledAt || null,
      summaryContext: summaryText,
      status: 'briefing_ready',
      clientId: verifiedClientId,
      clientName: clientName,
      projectId: verifiedProjectId,
      projectName: projectName,
    });

    // 5. Dispatch Email to Attendees
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
          to: rawEmails,
          subject: `[Pre-Meeting Briefing] ${meeting.title} (${projectName})`,
          html: `
            <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 16px; background-color: #ffffff;">
              <div style="display: flex; align-items: center; margin-bottom: 20px;">
                <h2 style="color: #0084FF; margin: 0; font-size: 20px;">Revora AI — Pre-Meeting Intelligence Brief</h2>
              </div>
              <p style="font-size: 14px; color: #1e293b; margin: 6px 0;"><strong>Meeting:</strong> ${meeting.title}</p>
              <p style="font-size: 14px; color: #1e293b; margin: 6px 0;"><strong>Client:</strong> ${clientName}</p>
              <p style="font-size: 14px; color: #1e293b; margin: 6px 0;"><strong>Project:</strong> ${projectName}</p>
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
                <li>Automated action item and decision tracking for ${projectName}</li>
                <li>Post-meeting executive summary delivery</li>
              </ul>
              <p style="font-size: 11px; color: #94a3b8; margin-top: 24px; border-top: 1px solid #f1f5f9; padding-top: 12px;">
                Automated by Revora AI Meeting Assistant Agent for ${clientName}.
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
      clientId: meeting.clientId,
      client_id: meeting.clientId,
      clientName: meeting.clientName,
      client_name: meeting.clientName,
      projectId: meeting.projectId,
      project_id: meeting.projectId,
      projectName: meeting.projectName,
      project_name: meeting.projectName,
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