const nodemailer = require('nodemailer');

async function testEmail() {
  // Create a fake SMTP test account at Ethereal
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
    from: '"Futurrizon AI" <assistant@futurrizon.com>',
    to: 'user@example.com',
    subject: 'Pre-Meeting Briefing Test',
    html: '<h2>Briefing Card</h2><p>This is a test email reminder for your upcoming meeting.</p>',
  });

  console.log('Message sent successfully!');
  console.log('Preview URL: %s', nodemailer.getTestMessageUrl(info));
}

testEmail();