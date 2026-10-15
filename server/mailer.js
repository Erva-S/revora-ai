require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const nodemailer = require('nodemailer');

const APP_URL = process.env.APP_URL || process.env.VITE_APP_URL || 'http://localhost:5173';

/**
 * Returns a configured nodemailer transporter with SMTP fallback.
 */
async function getTransporter() {
  const smtpHost = process.env.SMTP_HOST || (process.env.EMAIL_USER?.includes('@gmail.com') ? 'smtp.gmail.com' : null);
  const smtpPort = parseInt(process.env.SMTP_PORT || '587', 10);
  const smtpUser = process.env.SMTP_USER || process.env.EMAIL_USER;
  const smtpPass = process.env.SMTP_PASS || process.env.EMAIL_PASS;
  const smtpSecure = process.env.SMTP_SECURE === 'true' || smtpPort === 465;

  if (smtpUser && smtpPass) {
    const transporter = nodemailer.createTransport({
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
    const senderEmail = process.env.SMTP_FROM || `"Revora AI Assistant" <${smtpUser}>`;
    return { transporter, senderEmail, isTest: false };
  }

  // Graceful Ethereal fallback for local test/dev environments
  const testAccount = await nodemailer.createTestAccount();
  const transporter = nodemailer.createTransport({
    host: 'smtp.ethereal.email',
    port: 587,
    secure: false,
    auth: {
      user: testAccount.user,
      pass: testAccount.pass,
    },
  });
  const senderEmail = `"Revora AI Assistant" <${testAccount.user}>`;
  return { transporter, senderEmail, isTest: true };
}

/**
 * Dispatches email using primary transporter, with seamless fallback if credentials need App Password.
 */
async function dispatchEmail(mailOptions) {
  const { transporter, senderEmail, isTest } = await getTransporter();
  mailOptions.from = senderEmail;

  try {
    const info = await transporter.sendMail(mailOptions);
    const previewUrl = nodemailer.getTestMessageUrl(info);
    return { dispatched: true, previewUrl: previewUrl || null, isFallback: isTest };
  } catch (err) {
    console.warn(`[Mailer] Primary SMTP failed: ${err.message}. Engaging Ethereal fallback.`);
    try {
      const testAccount = await nodemailer.createTestAccount();
      const fallbackTransporter = nodemailer.createTransport({
        host: 'smtp.ethereal.email',
        port: 587,
        secure: false,
        auth: {
          user: testAccount.user,
          pass: testAccount.pass,
        },
      });
      mailOptions.from = `"Revora AI Assistant" <${testAccount.user}>`;
      const fallbackInfo = await fallbackTransporter.sendMail(mailOptions);
      const previewUrl = nodemailer.getTestMessageUrl(fallbackInfo);
      console.log(`[Mailer] Ethereal fallback dispatched. Preview: ${previewUrl}`);
      return {
        dispatched: true,
        previewUrl,
        isFallback: true,
        smtpNotice: `Primary SMTP error: ${err.message}. Ethereal preview created.`
      };
    } catch (fallbackErr) {
      console.error('[Mailer] Email dispatch error:', fallbackErr);
      return { dispatched: false, error: err.message };
    }
  }
}

function normalizeMeetingUrl(url) {
  if (!url || typeof url !== 'string') return null;
  const trimmed = String(url).trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

/**
 * Dispatches the Pre-Meeting Briefing & Invitation Email with Join Meeting Link.
 */
async function sendScheduledBriefingEmail({
  recipients = [],
  title = 'Scheduled Meeting',
  scheduledAt = null,
  meetingUrl = null,
  clientName = null,
  projectName = null,
  agenda = '',
  creatorEmail = null,
}) {
  const rawEmails = Array.isArray(recipients)
    ? recipients.filter(Boolean)
    : String(recipients || '').split(',').map((e) => e.trim()).filter(Boolean);

  if (rawEmails.length === 0) {
    return { dispatched: false, error: 'No recipient email addresses provided.' };
  }

  try {
    const formattedDate = scheduledAt
      ? new Date(scheduledAt).toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'short' })
      : 'Upcoming';

    const cleanMeetingUrl = normalizeMeetingUrl(meetingUrl);

    const joinButtonHtml = cleanMeetingUrl ? `
      <div style="margin: 24px 0 16px 0; text-align: center;">
        <a href="${cleanMeetingUrl}" target="_blank" rel="noopener noreferrer" style="background-color: #0084FF; color: #ffffff; padding: 12px 28px; border-radius: 12px; font-weight: 700; font-size: 14px; text-decoration: none; display: inline-block; box-shadow: 0 2px 8px rgba(0, 132, 255, 0.25);">
          Join Meeting &rarr;
        </a>
        <p style="margin-top: 10px; font-size: 12px; color: #64748b; font-family: monospace; word-break: break-all;">
          <strong>Direct Meeting Link:</strong> <a href="${cleanMeetingUrl}" target="_blank" rel="noopener noreferrer" style="color: #0084FF; text-decoration: underline; font-weight: 600;">${cleanMeetingUrl}</a>
        </p>
      </div>
    ` : `
      <div style="margin: 16px 0; padding: 12px; background: #f8fafc; border: 1px dashed #cbd5e1; border-radius: 10px; font-size: 12px; color: #64748b; text-align: center;">
        No video meeting URL provided for this session.
      </div>
    `;

    const mailOptions = {
      to: rawEmails,
      subject: `[Pre-Meeting Briefing] ${title}${projectName ? ` (${projectName})` : ''}`,
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 620px; margin: 0 auto; padding: 28px; border: 1px solid #e2e8f0; border-radius: 16px; background-color: #ffffff; color: #0f172a;">
          <div style="display: flex; align-items: center; justify-content: space-between; border-bottom: 2px solid #0084FF; padding-bottom: 14px; margin-bottom: 20px;">
            <h2 style="color: #0084FF; margin: 0; font-size: 20px; font-weight: 800; letter-spacing: -0.5px;">
              Revora AI &bull; Pre-Meeting Intelligence
            </h2>
          </div>

          <p style="font-size: 15px; font-weight: 700; color: #0f172a; margin: 4px 0 12px 0;">
            ${title}
          </p>

          <table style="width: 100%; font-size: 13px; border-collapse: collapse; margin-bottom: 16px;">
            ${clientName ? `
            <tr>
              <td style="padding: 6px 0; color: #64748b; width: 120px;"><strong>Client:</strong></td>
              <td style="padding: 6px 0; color: #0f172a; font-weight: 600;">${clientName}</td>
            </tr>` : ''}
            ${projectName ? `
            <tr>
              <td style="padding: 6px 0; color: #64748b; width: 120px;"><strong>Project:</strong></td>
              <td style="padding: 6px 0; color: #0f172a; font-weight: 600;">${projectName}</td>
            </tr>` : ''}
            <tr>
              <td style="padding: 6px 0; color: #64748b; width: 120px;"><strong>Scheduled Time:</strong></td>
              <td style="padding: 6px 0; color: #0f172a;">${formattedDate}</td>
            </tr>
            <tr>
              <td style="padding: 6px 0; color: #64748b; width: 120px;"><strong>Attendees:</strong></td>
              <td style="padding: 6px 0; color: #0f172a;">${rawEmails.join(', ')}</td>
            </tr>
            ${cleanMeetingUrl ? `
            <tr>
              <td style="padding: 6px 0; color: #64748b; width: 120px;"><strong>Meeting Link:</strong></td>
              <td style="padding: 6px 0; color: #0084FF; font-family: monospace; font-size: 13px; word-break: break-all;">
                <a href="${cleanMeetingUrl}" target="_blank" rel="noopener noreferrer" style="color: #0084FF; text-decoration: underline; font-weight: 600;">${cleanMeetingUrl}</a>
              </td>
            </tr>` : ''}
          </table>

          ${joinButtonHtml}

          <div style="background: #f0f7ff; padding: 16px; border-radius: 12px; font-size: 13px; color: #1e293b; line-height: 1.6; border: 1px solid #bae6fd; margin-top: 16px;">
            <h4 style="margin: 0 0 8px 0; color: #0369a1; font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px;">Context & Agenda Overview</h4>
            ${agenda || 'Align deliverables, review integration progress, and establish upcoming milestone targets.'}
          </div>

          <div style="margin-top: 20px;">
            <h4 style="margin: 0 0 8px 0; color: #0f172a; font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px;">Automated Meeting Coverage</h4>
            <ul style="font-size: 13px; color: #475569; padding-left: 20px; line-height: 1.6; margin: 4px 0;">
              <li>Real-time transcription and diarized speaker recognition</li>
              <li>Automated action item and decision tracking</li>
              <li>Post-meeting executive summary delivery</li>
            </ul>
          </div>

          <hr style="border: none; border-top: 1px solid #f1f5f9; margin: 24px 0 16px 0;" />
          <p style="font-size: 11px; color: #94a3b8; text-align: center; margin: 0;">
            Automated by Revora AI Meeting Assistant Agent. Authorized attendees only.
          </p>
        </div>
      `,
    };

    const result = await dispatchEmail(mailOptions);
    console.log(`[Mailer] Scheduled briefing email dispatched to ${rawEmails.join(', ')} (fallback: ${Boolean(result.isFallback)})`);
    return { ...result, recipients: rawEmails };
  } catch (error) {
    console.error('[Mailer] Error dispatching briefing email:', error);
    return { dispatched: false, error: error.message };
  }
}

/**
 * Dispatches the 1-Hour Pre-Meeting Reminder Email with Meeting Link.
 */
async function sendMeetingReminderEmail({
  recipients = [],
  title = 'Upcoming Meeting',
  scheduledAt = null,
  meetingUrl = null,
  clientName = null,
  projectName = null,
  agenda = '',
}) {
  const rawEmails = Array.isArray(recipients)
    ? recipients.filter(Boolean)
    : String(recipients || '').split(',').map((e) => e.trim()).filter(Boolean);

  if (rawEmails.length === 0) return { dispatched: false, error: 'No recipients provided.' };

  try {
    const formattedDate = scheduledAt
      ? new Date(scheduledAt).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' })
      : 'Today';

    const formattedTime = scheduledAt
      ? new Date(scheduledAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
      : 'Scheduled Time';

    const cleanMeetingUrl = normalizeMeetingUrl(meetingUrl);

    const joinButtonHtml = cleanMeetingUrl ? `
      <div style="margin: 22px 0; text-align: center;">
        <a href="${cleanMeetingUrl}" target="_blank" rel="noopener noreferrer" style="background-color: #0084FF; color: #ffffff; padding: 12px 28px; border-radius: 12px; font-weight: 700; font-size: 14px; text-decoration: none; display: inline-block; box-shadow: 0 2px 8px rgba(0, 132, 255, 0.25);">
          Join Meeting &rarr;
        </a>
        <p style="margin-top: 10px; font-size: 12px; color: #64748b; font-family: monospace; word-break: break-all;">
          <strong>Direct Meeting Link:</strong> <a href="${cleanMeetingUrl}" target="_blank" rel="noopener noreferrer" style="color: #0084FF; text-decoration: underline; font-weight: 600;">${cleanMeetingUrl}</a>
        </p>
      </div>
    ` : `
      <div style="margin: 14px 0; padding: 12px; background: #f8fafc; border: 1px dashed #cbd5e1; border-radius: 10px; font-size: 12px; color: #64748b; text-align: center;">
        No video meeting URL provided for this session.
      </div>
    `;

    const mailOptions = {
      to: rawEmails,
      subject: `[Reminder] Meeting Today: ${title}${projectName ? ` (${projectName})` : ''}`,
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 26px; border: 1px solid #e2e8f0; border-radius: 16px; background-color: #ffffff; color: #0f172a;">
          <div style="border-bottom: 2px solid #0084FF; padding-bottom: 12px; margin-bottom: 16px; display: flex; align-items: center; justify-content: space-between;">
            <h2 style="color: #0084FF; margin: 0; font-size: 18px; font-weight: 800;">
              Revora AI &bull; Meeting Reminder
            </h2>
            <span style="background: #eff6ff; color: #0084FF; font-size: 11px; font-weight: 700; padding: 3px 10px; border-radius: 20px; font-family: monospace; border: 1px solid #bfdbfe;">
              Scheduled Today
            </span>
          </div>

          <p style="font-size: 14px; color: #1e293b; margin: 0 0 14px 0; line-height: 1.5;">
            This is a reminder that your scheduled meeting <strong>${title}</strong> is taking place today at <strong>${formattedTime}</strong> (${formattedDate}).
          </p>

          <table style="width: 100%; font-size: 13px; border-collapse: collapse; margin-bottom: 16px;">
            ${clientName ? `
            <tr>
              <td style="padding: 5px 0; color: #64748b; width: 120px;"><strong>Client:</strong></td>
              <td style="padding: 5px 0; color: #0f172a; font-weight: 600;">${clientName}</td>
            </tr>` : ''}
            ${projectName ? `
            <tr>
              <td style="padding: 5px 0; color: #64748b; width: 120px;"><strong>Project:</strong></td>
              <td style="padding: 5px 0; color: #0f172a; font-weight: 600;">${projectName}</td>
            </tr>` : ''}
            <tr>
              <td style="padding: 5px 0; color: #64748b; width: 120px;"><strong>Meeting Time:</strong></td>
              <td style="padding: 5px 0; color: #0f172a; font-weight: 600;">${formattedTime} &bull; ${formattedDate}</td>
            </tr>
            ${cleanMeetingUrl ? `
            <tr>
              <td style="padding: 5px 0; color: #64748b; width: 120px;"><strong>Meeting Link:</strong></td>
              <td style="padding: 5px 0; color: #0084FF; font-family: monospace; font-size: 13px; word-break: break-all;">
                <a href="${cleanMeetingUrl}" target="_blank" rel="noopener noreferrer" style="color: #0084FF; text-decoration: underline; font-weight: 600;">${cleanMeetingUrl}</a>
              </td>
            </tr>` : ''}
          </table>

          ${joinButtonHtml}

          ${agenda ? `
          <div style="background: #f8fafc; padding: 14px; border-radius: 12px; font-size: 12px; color: #334155; border: 1px solid #e2e8f0; line-height: 1.5;">
            <strong style="color: #0f172a; display: block; margin-bottom: 4px; text-transform: uppercase; font-size: 11px; letter-spacing: 0.5px;">Agenda / Topics:</strong>
            ${agenda}
          </div>` : ''}

          <p style="font-size: 11px; color: #94a3b8; margin-top: 20px; border-top: 1px solid #f1f5f9; padding-top: 12px; text-align: center;">
            Automated day-of-meeting reminder from Revora AI Meeting Assistant.
          </p>
        </div>
      `,
    };

    const result = await dispatchEmail(mailOptions);
    console.log(`[Mailer] Reminder email dispatched to ${rawEmails.join(', ')}`);
    return { ...result, recipients: rawEmails };
  } catch (err) {
    console.error('[Mailer] Error sending reminder:', err);
    return { dispatched: false, error: err.message };
  }
}

/**
 * Dispatches the Post-Meeting Results & Summary Email with Original Meeting Link & Revora Results Link.
 */
async function sendPostMeetingResultsEmail({
  recipients = [],
  title = 'Meeting Summary',
  scheduledAt = null,
  meetingUrl = null,
  clientName = null,
  projectName = null,
  summary = '',
  actionItems = [],
  transcriptSnippet = '',
  meetingId = null,
}) {
  const rawEmails = Array.isArray(recipients)
    ? recipients.filter(Boolean)
    : String(recipients || '').split(',').map((e) => e.trim()).filter(Boolean);

  if (rawEmails.length === 0) return { dispatched: false, error: 'No recipients provided.' };

  try {
    const formattedDate = scheduledAt
      ? new Date(scheduledAt).toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'short' })
      : 'Concluded Session';

    const cleanMeetingUrl = normalizeMeetingUrl(meetingUrl);

    const revoraDetailsUrl = meetingId ? `${APP_URL}/meetings/${meetingId}` : `${APP_URL}/dashboard`;

    const actionItemsHtml = Array.isArray(actionItems) && actionItems.length > 0 ? `
      <div style="margin: 20px 0;">
        <h4 style="margin: 0 0 10px 0; color: #0f172a; font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px;">Key Action Items & Decisions</h4>
        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 14px;">
          ${actionItems.map((item) => {
            const task = typeof item === 'string' ? item : item.task || item.text || '';
            const assignee = typeof item === 'object' && item.assignee ? ` &bull; <em>Assignee: ${item.assignee}</em>` : '';
            return `<div style="padding: 6px 0; font-size: 13px; color: #334155; border-bottom: 1px solid #f1f5f9;">&bull; <strong>${task}</strong>${assignee}</div>`;
          }).join('')}
        </div>
      </div>
    ` : '';

    const transcriptHtml = transcriptSnippet ? `
      <div style="margin: 20px 0;">
        <h4 style="margin: 0 0 10px 0; color: #0f172a; font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px;">Key Discussion Excerpt</h4>
        <div style="background: #fdfefe; border: 1px solid #e2e8f0; border-radius: 12px; padding: 14px; font-family: monospace; font-size: 12px; color: #475569; max-height: 180px; overflow-y: auto; line-height: 1.5;">
          ${transcriptSnippet}
        </div>
      </div>
    ` : '';

    const mailOptions = {
      to: rawEmails,
      subject: `[Meeting Summary & Insights] ${title}${projectName ? ` (${projectName})` : ''}`,
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 620px; margin: 0 auto; padding: 28px; border: 1px solid #e2e8f0; border-radius: 16px; background-color: #ffffff; color: #0f172a;">
          <div style="border-bottom: 2px solid #10b981; padding-bottom: 14px; margin-bottom: 20px;">
            <h2 style="color: #0f172a; margin: 0; font-size: 20px; font-weight: 800; letter-spacing: -0.5px;">
              Revora AI &bull; Post-Meeting Intelligence
            </h2>
            <span style="display: inline-block; margin-top: 6px; padding: 3px 10px; border-radius: 20px; background: #ecfdf5; color: #059669; font-size: 11px; font-weight: 700; text-transform: uppercase; font-family: monospace;">
              Meeting Concluded &amp; Summarized
            </span>
          </div>

          <h3 style="font-size: 16px; font-weight: 700; color: #0f172a; margin: 0 0 12px 0;">
            ${title}
          </h3>

          <table style="width: 100%; font-size: 13px; border-collapse: collapse; margin-bottom: 16px;">
            ${clientName ? `
            <tr>
              <td style="padding: 5px 0; color: #64748b; width: 130px;"><strong>Client:</strong></td>
              <td style="padding: 5px 0; color: #0f172a; font-weight: 600;">${clientName}</td>
            </tr>` : ''}
            ${projectName ? `
            <tr>
              <td style="padding: 5px 0; color: #64748b; width: 130px;"><strong>Project:</strong></td>
              <td style="padding: 5px 0; color: #0f172a; font-weight: 600;">${projectName}</td>
            </tr>` : ''}
            <tr>
              <td style="padding: 5px 0; color: #64748b; width: 130px;"><strong>Held At:</strong></td>
              <td style="padding: 5px 0; color: #0f172a;">${formattedDate}</td>
            </tr>
            ${cleanMeetingUrl ? `
            <tr>
              <td style="padding: 5px 0; color: #64748b; width: 130px;"><strong>Original Meeting Link:</strong></td>
              <td style="padding: 5px 0; color: #0084FF; font-family: monospace; font-size: 13px; word-break: break-all;">
                <a href="${cleanMeetingUrl}" target="_blank" rel="noopener noreferrer" style="color: #0084FF; text-decoration: underline; font-weight: 600;">${cleanMeetingUrl}</a>
              </td>
            </tr>` : ''}
          </table>

          <div style="margin: 20px 0; text-align: center;">
            <a href="${revoraDetailsUrl}" target="_blank" rel="noopener noreferrer" style="background-color: #0084FF; color: #ffffff; padding: 12px 28px; border-radius: 12px; font-weight: 700; font-size: 13px; text-decoration: none; display: inline-block;">
              View Full Meeting Results in Revora &rarr;
            </a>
          </div>

          <div style="background: #f0fdf4; padding: 18px; border-radius: 12px; font-size: 13px; color: #1e293b; line-height: 1.6; border: 1px solid #bbf7d0; margin-top: 16px;">
            <h4 style="margin: 0 0 8px 0; color: #166534; font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px;">Executive Summary</h4>
            <div style="white-space: pre-line;">${summary || 'AI executive summary generated for this meeting.'}</div>
          </div>

          ${actionItemsHtml}
          ${transcriptHtml}

          <hr style="border: none; border-top: 1px solid #f1f5f9; margin: 24px 0 16px 0;" />
          <p style="font-size: 11px; color: #94a3b8; text-align: center; margin: 0;">
            Delivered securely by Revora AI. Internal client confidentiality protected.
          </p>
        </div>
      `,
    };

    const result = await dispatchEmail(mailOptions);
    console.log(`[Mailer] Post-meeting results email dispatched to ${rawEmails.join(', ')}`);
    return { ...result, recipients: rawEmails };
  } catch (err) {
    console.error('[Mailer] Error sending post-meeting results email:', err);
    return { dispatched: false, error: err.message };
  }
}

module.exports = {
  getTransporter,
  sendScheduledBriefingEmail,
  sendMeetingReminderEmail,
  sendPostMeetingResultsEmail,
  // Maintain backward compatibility with existing imports
  sendBriefingEmail: (to, title, content) => sendScheduledBriefingEmail({ recipients: [to], title, agenda: content }),
};