require('dotenv').config();

const express = require('express');
const router = express.Router();
const Meeting = require('../models/Meeting');
const supabase = require('../supabase');
const { 
  sendScheduledBriefingEmail, 
  sendMeetingReminderEmail,
  sendPostMeetingResultsEmail 
} = require('../mailer');

// Helper to format meeting response with camelCase & snake_case compatibility
function formatMeetingJson(meetingInstance) {
  const plain = typeof meetingInstance.toJSON === 'function' ? meetingInstance.toJSON() : meetingInstance;
  let parsedActionItems = [];
  try {
    if (plain.actionItems) {
      parsedActionItems = typeof plain.actionItems === 'string' ? JSON.parse(plain.actionItems) : plain.actionItems;
    }
  } catch (_) {
    parsedActionItems = [];
  }

  return {
    ...plain,
    scheduledAt: plain.scheduledAt || null,
    scheduled_at: plain.scheduledAt || null,
    meetingUrl: plain.meetingUrl || null,
    meeting_url: plain.meetingUrl || null,
    clientId: plain.clientId || null,
    client_id: plain.clientId || null,
    clientName: plain.clientName || null,
    client_name: plain.clientName || null,
    projectId: plain.projectId || null,
    project_id: plain.projectId || null,
    projectName: plain.projectName || null,
    project_name: plain.projectName || null,
    summary: plain.summary || null,
    transcript: plain.transcript || null,
    actionItems: parsedActionItems,
    action_items: parsedActionItems,
  };
}

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

    res.json(visibleMeetings.map(formatMeetingJson));
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

    res.json(formatMeetingJson(meeting));
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
      meetingUrl: bodyMeetingUrl,
      meeting_url: bodyMeeting_url,
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

    const validMeetingUrl = (bodyMeetingUrl || bodyMeeting_url || '').trim() || null;

    const summaryText = `Pre-meeting briefing compiled for "${title || 'New Scheduled Meeting'}". Client: ${clientName} | Project: ${projectName}. Key focus: ${
      agenda || 'Align deliverables, review API integration, and discuss upcoming milestones.'
    }`;

    // 4. Save Meeting with verified relationships & meetingUrl in SQLite
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
      meetingUrl: validMeetingUrl,
    });

    // 5. Dispatch Email to Attendees using mailer module (only if requested)
    let emailStatus = { dispatched: false, error: null, previewUrl: null };
    const rawEmails = (recipientEmail || '').split(',').map((e) => e.trim()).filter(Boolean);
    const shouldDispatchEmail = req.body.sendEmail !== false && req.body.dispatchEmail !== false;

    if (shouldDispatchEmail && rawEmails.length > 0) {
      emailStatus = await sendScheduledBriefingEmail({
        recipients: rawEmails,
        title: meeting.title,
        scheduledAt: scheduledAt || null,
        meetingUrl: validMeetingUrl,
        clientName: clientName,
        projectName: projectName,
        agenda: agenda || summaryText,
        creatorEmail: authorEmail,
      });
    } else {
      emailStatus = { dispatched: false, skipped: true, error: null, previewUrl: null };
    }

    res.status(201).json({
      ...formatMeetingJson(meeting),
      summaryContext: summaryText,
      emailStatus,
      status: 'Sent & Ready',
    });
  } catch (error) {
    console.error('Error in POST /api/briefings:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/briefings/:id/results-email - Dispatch post-meeting summary & transcript email to attendees
router.post('/:id/results-email', async (req, res) => {
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

    // Multi-tenant check
    if (!isAdmin && userClientId && meeting.clientId && meeting.clientId !== userClientId) {
      return res.status(403).json({ error: 'Access denied: You are not authorized to dispatch emails for another client.' });
    }

    const { summary, actionItems, transcriptSnippet, recipients: overrideRecipients } = req.body;

    const targetRecipients = overrideRecipients || meeting.recipientEmail || '';
    const rawEmails = String(targetRecipients).split(',').map((e) => e.trim()).filter(Boolean);

    if (rawEmails.length === 0) {
      return res.status(400).json({ error: 'No recipient email addresses found for this meeting.' });
    }

    const emailStatus = await sendPostMeetingResultsEmail({
      recipients: rawEmails,
      title: meeting.title,
      scheduledAt: meeting.scheduledAt,
      meetingUrl: meeting.meetingUrl,
      clientName: meeting.clientName,
      projectName: meeting.projectName,
      summary: summary || meeting.summary || 'AI Executive Summary generated.',
      actionItems: actionItems || meeting.actionItems || [],
      transcriptSnippet: transcriptSnippet || (meeting.transcript ? meeting.transcript.slice(0, 400) + '...' : ''),
      meetingId: meeting.id,
    });

    if (emailStatus.dispatched) {
      await meeting.update({ resultsEmailSent: true });
    }

    res.json({ success: true, emailStatus });
  } catch (error) {
    console.error('Error in POST /api/briefings/:id/results-email:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/briefings/:id/reminder-email - Dispatch day-of reminder email to attendees
router.post('/:id/reminder-email', async (req, res) => {
  try {
    const { id } = req.params;
    const userEmail = (req.headers['x-user-email'] || req.query.email || '').trim().toLowerCase();
    const userRole = (req.headers['x-user-role'] || req.query.role || '').trim().toLowerCase();
    const userClientId = (req.headers['x-client-id'] || req.query.clientId || '').trim();

    const meeting = await Meeting.findByPk(id);
    if (!meeting) {
      return res.status(404).json({ error: 'Meeting not found.' });
    }

    const isAdmin = userRole === 'admin' || userEmail === 'evv18407@gmail.com';

    // Multi-tenant check
    if (!isAdmin && userClientId && meeting.clientId && meeting.clientId !== userClientId) {
      return res.status(403).json({ error: 'Access denied: You are not authorized to dispatch reminders for another client.' });
    }

    const { recipients: overrideRecipients } = req.body || {};
    const targetRecipients = overrideRecipients || meeting.recipientEmail || '';
    const rawEmails = String(targetRecipients).split(',').map((e) => e.trim()).filter(Boolean);

    if (rawEmails.length === 0) {
      return res.status(400).json({ error: 'No recipient email addresses found for this meeting.' });
    }

    const emailStatus = await sendMeetingReminderEmail({
      recipients: rawEmails,
      title: meeting.title || 'Upcoming Meeting',
      scheduledAt: meeting.scheduledAt || meeting.startTime,
      meetingUrl: meeting.meetingUrl || null,
      clientName: meeting.clientName || null,
      projectName: meeting.projectName || null,
      agenda: meeting.agenda || meeting.summaryContext || '',
    });

    if (emailStatus.dispatched) {
      await meeting.update({ reminderSent: true });
    }

    res.json({ success: true, emailStatus, reminderSent: true });
  } catch (error) {
    console.error('Error in POST /api/briefings/:id/reminder-email:', error);
    res.status(500).json({ error: error.message });
  }
});

// PATCH /api/briefings/:id/results - Sync post-meeting summary, transcript, and action items
router.patch('/:id/results', async (req, res) => {
  try {
    const { id } = req.params;
    const meeting = await Meeting.findByPk(id);
    if (!meeting) {
      return res.status(404).json({ error: 'Meeting not found.' });
    }

    const { summary, transcript, actionItems, status } = req.body;
    const patch = {};
    if (summary !== undefined) patch.summary = summary;
    if (transcript !== undefined) patch.transcript = typeof transcript === 'string' ? transcript : JSON.stringify(transcript);
    if (actionItems !== undefined) patch.actionItems = typeof actionItems === 'string' ? actionItems : JSON.stringify(actionItems);
    if (status !== undefined) patch.status = status;

    await meeting.update(patch);
    res.json(formatMeetingJson(meeting));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;