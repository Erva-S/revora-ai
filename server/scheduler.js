const cron = require('node-cron');
const sequelize = require('./db');
const { sendBriefingEmail } = require('./mailer');

const startScheduler = () => {
  cron.schedule('* * * * *', async () => {
    console.log('[Scheduler] Checking for upcoming meetings...');

    try {
      // First, ensure the reminderSent column exists in the table
      await sequelize.query(`
        ALTER TABLE Meetings ADD COLUMN reminderSent BOOLEAN DEFAULT 0;
      `).catch(() => {
        // Ignores error if column already exists
      });

      // Fetch meetings that fall in the window and haven't had a reminder sent yet (reminderSent = 0 or NULL)
      const [meetings] = await sequelize.query(`
        SELECT * FROM Meetings 
        WHERE (reminderSent IS NULL OR reminderSent = 0)
      `);

      const now = new Date();
      const oneHourLater = new Date(now.getTime() + 60 * 60 * 1000);

      for (const meeting of meetings) {
        const meetingTime = new Date(meeting.startTime);

        // Check if meeting starts within the 1-hour window
        if (meetingTime > now && meetingTime <= oneHourLater) {
          console.log(`[Scheduler] 1-hour window matched for: ${meeting.title}`);

          await sendBriefingEmail(
            meeting.recipientEmail || 'test@example.com',
            meeting.title || 'Upcoming Meeting',
            'Here is your automated pre-meeting briefing overview.'
          );

          // Mark reminder as sent so it won't trigger again
          await sequelize.query(
            `UPDATE Meetings SET reminderSent = 1 WHERE id = ${meeting.id}`
          );
          console.log(`[Scheduler] Marked reminderSent = true for meeting ID ${meeting.id}`);
        }
      }
    } catch (error) {
      console.error('[Scheduler] Error checking meetings:', error);
    }
  });
};

module.exports = { startScheduler };