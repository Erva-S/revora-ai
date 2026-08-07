const sequelize = require('./db');
const Meeting = require('./models/Meeting');

async function seedDatabase() {
  try {
    await sequelize.sync({ force: true });
    
    await Meeting.create({
      id: 1,
      title: 'Project Sprint Alignment',
      recipientEmail: 'team@futurrizon.com',
      summaryContext: 'Pre-meeting briefing for "Project Sprint Alignment". Key objective: align deliverables and review task status.',
      agendaTopics: ['Project Status Review', 'Task Assignments', 'Blockers & Risks'],
      status: 'Ready'
    });

    console.log('Database seeded successfully with Meeting ID 1!');
    process.exit(0);
  } catch (error) {
    console.error('Failed to seed database:', error);
    process.exit(1);
  }
}

seedDatabase();