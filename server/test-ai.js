require('dotenv').config();
const { generateBriefing } = require('./aiService');

async function test() {
  console.log('Generating AI briefing using Gemini...');
  const briefing = await generateBriefing(
    'Q3 Budget Planning & Project Roadmap',
    'Review remaining funds for Q3 and align on key deliverables for the engineering team.'
  );
  console.log('\n--- Generated Briefing ---\n');
  console.log(briefing);
}

test();