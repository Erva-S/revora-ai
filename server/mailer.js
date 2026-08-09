const nodemailer = require('nodemailer');

const sendBriefingEmail = async (toEmail, meetingTitle, briefingContent) => {
  try {
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

    const info = await transporter.sendMail({
      from: '"Futurrizon AI Assistant" <no-reply@futurrizon.com>',
      to: toEmail,
      subject: `Upcoming Meeting Briefing: ${meetingTitle}`,
      html: `
        <h2>Pre-Meeting Briefing Reminder</h2>
        <p>Your meeting <strong>${meetingTitle}</strong> starts in 1 hour.</p>
        <hr />
        <h3>Briefing Summary</h3>
        <p>${briefingContent}</p>
      `
    });

    console.log('Email sent successfully!');
    console.log('Preview URL: %s', nodemailer.getTestMessageUrl(info));
  } catch (error) {
    console.error('Error sending email:', error);
  }
};

module.exports = { sendBriefingEmail };