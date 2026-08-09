const { GoogleGenerativeAI } = require('@google/generative-ai');

// Initialize Gemini API
const apiKey = process.env.GEMINI_API_KEY || '';
const genAI = apiKey ? new GoogleGenerativeAI(apiKey) : null;

async function generateBriefing(title, details) {
  try {
    if (!genAI) {
      throw new Error("Missing GEMINI_API_KEY in server .env");
    }

    // Using gemini-1.5-flash for fast, reliable responses
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

    const prompt = `
You are an executive assistant preparing a concise pre-meeting briefing card for meeting attendees.

Meeting Title: ${title}
Meeting Context/Details: ${details || 'Standard strategy alignment and updates.'}

Please generate a well-structured Markdown briefing card containing:
### 📌 Executive Overview
(1-2 sentence summary of what this meeting covers)

### 🎯 Key Topics to Discuss
* (Bullet point 1)
* (Bullet point 2)
* (Bullet point 3)

### ❓ Suggested Questions to Ask
* (Question 1)
* (Question 2)

### 🚀 Recommended Next Steps
* (Action item 1)
* (Action item 2)
`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    return response.text();

  } catch (error) {
    console.error('Gemini API Error:', error.message);
    
    // Fallback briefing text so meeting creation never crashes or displays empty errors
    return `### 📌 Executive Overview\nBriefing overview for **${title}**.\n\n### 🎯 Key Topics to Discuss\n* Review project milestones and objectives.\n* Align on deliverable timelines.\n* Address key operational blockers.\n\n### ❓ Suggested Questions to Ask\n* What are the main priorities for this phase?\n* Are there any external dependencies?\n\n### 🚀 Recommended Next Steps\n* Assign task owners.\n* Finalize upcoming schedule.`;
  }
}

async function extractTasksFromTranscript(transcript) {
  try {
    if (!genAI) {
      throw new Error("Missing GEMINI_API_KEY in server .env");
    }

    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

    const prompt = `
Analyze the following meeting transcript and extract all explicit action items, commitments, and assigned tasks.

Transcript:
"${transcript}"

Format the output strictly as a bulleted list:
* **Action Item:** [Task description] | **Assignee:** [Person's name or Unassigned] | **Deadline:** [Due date or TBD]
`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    return response.text();

  } catch (error) {
    console.error('Gemini Task Extraction Error:', error.message);
    return `* **Action Item:** Review transcript details | **Assignee:** Team | **Deadline:** TBD`;
  }
}

module.exports = {
  generateBriefing,
  extractTasksFromTranscript
};