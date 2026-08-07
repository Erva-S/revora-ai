const mongoose = require('mongoose');

const BriefingSchema = new mongoose.Schema({
  meetingId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Meeting',
    required: true
  },
  summaryContext: { type: String, required: true },
  keyTopics: [{ type: String }],
  generatedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Briefing', BriefingSchema);