const sequelize = require('./db');
const { sendMeetingReminderEmail } = require('./mailer');

const checkUpcomingMeetings = async () => {
  try {
    const [meetings] = await sequelize.query(`
      SELECT * FROM Meetings 
      WHERE (reminderSent IS NULL OR reminderSent = 0)
        AND (scheduledAt IS NOT NULL OR startTime IS NOT NULL)
    `);

    const now = new Date();
    const oneHourLater = new Date(now.getTime() + 60 * 60 * 1000);

    for (const meeting of meetings) {
      const rawTime = meeting.scheduledAt || meeting.startTime;
      const meetingTime = new Date(rawTime);

      if (!isNaN(meetingTime.getTime()) && meetingTime > now && meetingTime <= oneHourLater) {
        console.log(`[Scheduler] 1-hour pre-meeting window matched for: "${meeting.title}" (ID: ${meeting.id})`);

        const recipients = (meeting.recipientEmail || '')
          .split(',')
          .map((e) => e.trim())
          .filter(Boolean);

        if (recipients.length > 0) {
          await sendMeetingReminderEmail({
            recipients,
            title: meeting.title || 'Upcoming Meeting',
            scheduledAt: rawTime,
            meetingUrl: meeting.meetingUrl || null,
            clientName: meeting.clientName || null,
            projectName: meeting.projectName || null,
            agenda: meeting.agenda || meeting.summaryContext || '',
          });
        }

        // Mark reminderSent = 1 so it never duplicates
        await sequelize.query(
          `UPDATE Meetings SET reminderSent = 1 WHERE id = ${meeting.id}`
        );
        console.log(`[Scheduler] Marked reminderSent = 1 for meeting ID ${meeting.id}`);
      }
    }
  } catch (error) {
    console.error('[Scheduler] Error checking upcoming meeting reminders:', error.message);
  }
};

const startScheduler = () => {
  // Check immediately on startup
  checkUpcomingMeetings();
  // Poll every 60 seconds
  const intervalId = setInterval(checkUpcomingMeetings, 60 * 1000);
  return () => clearInterval(intervalId);
};

module.exports = { startScheduler };