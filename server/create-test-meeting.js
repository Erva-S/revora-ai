const sequelize = require('./db');

async function createMeeting() {
  try {
    // Check existing columns first
    const [columns] = await sequelize.query("PRAGMA table_info(Meetings);");
    console.log("Table columns:", columns.map(c => c.name));

    const meetingTime = new Date(Date.now() + 45 * 60 * 1000).toISOString();
    
    await sequelize.query(`
      INSERT INTO Meetings (title, startTime, createdAt, updatedAt) 
      VALUES ('Test Client Sync', '${meetingTime}', DATETIME('now'), DATETIME('now'))
    `);

    console.log('Test meeting successfully created for 45 mins from now!');
  } catch (err) {
    console.error('Error creating meeting:', err);
  } finally {
    process.exit();
  }
}

createMeeting();