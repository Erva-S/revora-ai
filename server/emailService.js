const nodemailer = require('nodemailer');

// Configure your email service (using Ethereal for testing or Gmail SMTP)
const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST || 'smtp.ethereal.email',
  port: process.env.EMAIL_PORT || 587,
  auth: {
    user: process.env.EMAIL_USER || 'test@ethereal.email',
    pass: process.env.EMAIL_PASS || 'testpass'
  }
});

async function sendPreMeetingBriefing(recipientEmail, meetingTitle, briefingText) {
  try {
    const info = await transporter.sendMail({
      from: '"Revora AI Assistant" <briefings@revora.ai>',
      to: recipientEmail,
      subject: `[Pre-Meeting Briefing] ${meetingTitle}`,
      html: `
        <div style="font-family: Arial, sans-serif; padding: 20px; color: #333;">
          <h2 style="color: #0084FF;">Pre-Meeting Executive Briefing</h2>
          <p><strong>Meeting:</strong> ${meetingTitle}</p>
          <hr style="border: 1px solid #eee;" />
          <div style="background: #f9f9f9; padding: 15px; border-radius: 8px; white-space: pre-wrap;">
            ${briefingText}
          </div>
          <br/>
          <p style="font-size: 12px; color: #777;">Sent automatically by Revora AI Meeting Assistant.</p>
        </div>
      `
    });

    console.log(`Briefing email sent to ${recipientEmail}: %s`, info.messageId);
    return true;
  } catch (error) {
    console.error('Failed to send email:', error);
    return false;
  }
}

module.exports = { sendPreMeetingBriefing };
