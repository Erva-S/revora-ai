const sequelize = require('./db');
const { sendMeetingReminderEmail } = require('./mailer');

const isSameCalendarDay = (date1, date2) => {
  if (!date1 || !date2) return false;
  const d1 = new Date(date1);
  const d2 = new Date(date2);
  if (isNaN(d1.getTime()) || isNaN(d2.getTime())) return false;

  const localMatch = (
    d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate()
  );
  const utcMatch = (
    d1.getUTCFullYear() === d2.getUTCFullYear() &&
    d1.getUTCMonth() === d2.getUTCMonth() &&
    d1.getUTCDate() === d2.getUTCDate()
  );
  return localMatch || utcMatch;
};

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
      if (meeting.status === 'cancelled') continue;

      const rawTime = meeting.scheduledAt || meeting.startTime;
      const meetingTime = new Date(rawTime);

      if (isNaN(meetingTime.getTime())) continue;

      // Don't send reminder for meetings that finished in the past (more than 15 minutes ago)
      if (meetingTime.getTime() < now.getTime() - 15 * 60 * 1000) continue;

      const isToday = isSameCalendarDay(meetingTime, now);
      const isWithinOneHour = meetingTime > now && meetingTime <= oneHourLater;

      // Check if it's the day of the meeting or within 1 hour
      if (isToday || isWithinOneHour) {
        // Anti-spam guard: if meeting was scheduled in the last 15 minutes and the call is still > 1 hour away,
        // wait so recipient doesn't receive scheduling email and day-of reminder at the exact same minute.
        if (meeting.createdAt) {
          const msSinceCreated = now.getTime() - new Date(meeting.createdAt).getTime();
          if (!isNaN(msSinceCreated) && msSinceCreated < 15 * 60 * 1000 && (meetingTime.getTime() - now.getTime()) > 60 * 60 * 1000) {
            continue;
          }
        }

        console.log(`[Scheduler] Day-of meeting reminder matched for: "${meeting.title}" (ID: ${meeting.id})`);

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

module.exports = { startScheduler, checkUpcomingMeetings, isSameCalendarDay };