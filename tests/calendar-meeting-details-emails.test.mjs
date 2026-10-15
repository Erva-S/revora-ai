import test from 'node:test';
import assert from 'node:assert/strict';

const API_BASE = 'http://localhost:5000/api/briefings';

const CLIENT_ERVA_ID = '627d5630-cd92-4b38-a7db-3d265cfd2f45';
const PROJECT_FULLSTACK_ID = '62131ea3-fb3a-482b-b49b-062190765c80'; // Belongs to Erva
const CLIENT_OTHER_ID = 'e0d75509-f88c-407a-8701-f271bbaa0000';

let createdMeetingId = null;
const testMeetingUrl = 'https://meet.google.com/abc-defg-hij';

test('1. Schedule meeting with meetingUrl persists URL, client, project, and dispatches briefing email', async () => {
  const scheduledTime = new Date(Date.now() + 45 * 60 * 1000).toISOString(); // 45 minutes from now

  const res = await fetch(API_BASE, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-user-role': 'admin',
      'x-user-email': 'evv18407@gmail.com',
      'x-user-id': 'admin-uuid',
    },
    body: JSON.stringify({
      title: 'Sprint Architecture & API Review',
      recipientEmail: 'client.erva@revora.ai, team@revora.ai',
      agenda: 'Review calendar deduplication, meeting details modal, and automated emails.',
      scheduledAt: scheduledTime,
      clientId: CLIENT_ERVA_ID,
      projectId: PROJECT_FULLSTACK_ID,
      meetingUrl: testMeetingUrl,
    }),
  });

  assert.equal(res.status, 201);
  const data = await res.json();
  assert.ok(data.id, 'Meeting ID should be returned');
  createdMeetingId = data.id;

  assert.equal(data.meetingUrl, testMeetingUrl);
  assert.equal(data.clientId, CLIENT_ERVA_ID);
  assert.equal(data.projectId, PROJECT_FULLSTACK_ID);
  assert.equal(data.clientName, 'Erva');
  assert.equal(data.projectName, 'full stack dev');
  assert.ok(data.emailStatus?.dispatched, 'Briefing email should be dispatched via nodemailer');
});

test('2. Retrieve meeting details via GET /api/briefings/:id returns persisted meeting link and metadata', async () => {
  assert.ok(createdMeetingId, 'Prerequisite createdMeetingId missing');

  const res = await fetch(`${API_BASE}/${createdMeetingId}`, {
    headers: {
      'x-user-role': 'admin',
      'x-user-email': 'evv18407@gmail.com',
    },
  });

  assert.equal(res.status, 200);
  const meeting = await res.json();
  assert.equal(meeting.id, createdMeetingId);
  assert.equal(meeting.meetingUrl, testMeetingUrl);
  assert.equal(meeting.title, 'Sprint Architecture & API Review');
  assert.ok(meeting.scheduledAt, 'ScheduledAt timestamp must exist');
});

test('3. Client isolation: User belonging to different client is rejected with 403', async () => {
  assert.ok(createdMeetingId, 'Prerequisite createdMeetingId missing');

  const res = await fetch(`${API_BASE}/${createdMeetingId}`, {
    headers: {
      'x-user-role': 'user',
      'x-user-email': 'other_client@domain.com',
      'x-client-id': CLIENT_OTHER_ID, // Different client
    },
  });

  assert.equal(res.status, 403);
  const data = await res.json();
  assert.match(data.error, /Access denied/i);
});

test('4. Authorized client user can access their own meeting details', async () => {
  assert.ok(createdMeetingId, 'Prerequisite createdMeetingId missing');

  const res = await fetch(`${API_BASE}/${createdMeetingId}`, {
    headers: {
      'x-user-role': 'user',
      'x-user-email': 'client.erva@revora.ai',
      'x-client-id': CLIENT_ERVA_ID, // Same client
    },
  });

  assert.equal(res.status, 200);
  const meeting = await res.json();
  assert.equal(meeting.id, createdMeetingId);
  assert.equal(meeting.meetingUrl, testMeetingUrl);
});

test('5. Post-meeting results sync: PATCH /api/briefings/:id/results updates summary, transcript, and action items', async () => {
  assert.ok(createdMeetingId, 'Prerequisite createdMeetingId missing');

  const testSummary = 'The team finalized calendar deduplication and automated meeting link distribution.';
  const testTranscript = 'Speaker 1: Are the meeting links integrated?\nSpeaker 2: Yes, fully verified.';
  const testActionItems = [
    { task: 'Deploy calendar updates', assignee: 'Engineering' },
    { task: 'Verify SMTP credentials', assignee: 'Operations' }
  ];

  const res = await fetch(`${API_BASE}/${createdMeetingId}/results`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      summary: testSummary,
      transcript: testTranscript,
      actionItems: testActionItems,
      status: 'completed',
    }),
  });

  assert.equal(res.status, 200);
  const updated = await res.json();
  assert.equal(updated.summary, testSummary);
  assert.equal(updated.transcript, testTranscript);
  assert.equal(updated.status, 'completed');
  assert.equal(updated.meetingUrl, testMeetingUrl);
});

test('6. Post-meeting results email dispatch with original meeting link and Revora deep link', async () => {
  assert.ok(createdMeetingId, 'Prerequisite createdMeetingId missing');

  const res = await fetch(`${API_BASE}/${createdMeetingId}/results-email`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-user-role': 'admin',
      'x-user-email': 'evv18407@gmail.com',
    },
    body: JSON.stringify({
      summary: 'Executive summary for completed session.',
      actionItems: [{ task: 'Test end to end email delivery' }],
    }),
  });

  assert.equal(res.status, 200);
  const data = await res.json();
  assert.ok(data.success);
  assert.ok(data.emailStatus?.dispatched);
});

test('7. Unauthorized client cannot dispatch results email for another client (403)', async () => {
  assert.ok(createdMeetingId, 'Prerequisite createdMeetingId missing');

  const res = await fetch(`${API_BASE}/${createdMeetingId}/results-email`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-user-role': 'user',
      'x-user-email': 'malicious@other.com',
      'x-client-id': CLIENT_OTHER_ID,
    },
    body: JSON.stringify({
      summary: 'Spoofed summary',
    }),
  });

  assert.equal(res.status, 403);
  const data = await res.json();
  assert.match(data.error, /Access denied/i);
});

test('8. Day-of meeting reminder email dispatch persists reminderSent flag and includes meeting URL', async () => {
  assert.ok(createdMeetingId, 'Prerequisite createdMeetingId missing');

  const res = await fetch(`${API_BASE}/${createdMeetingId}/reminder-email`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-user-role': 'admin',
      'x-user-email': 'evv18407@gmail.com',
    },
  });

  assert.equal(res.status, 200);
  const data = await res.json();
  assert.ok(data.success);
  assert.ok(data.emailStatus?.dispatched);
  assert.equal(data.reminderSent, true);

  // Verify meeting retrieval now reflects reminderSent = true
  const checkRes = await fetch(`${API_BASE}/${createdMeetingId}`, {
    headers: {
      'x-user-role': 'admin',
      'x-user-email': 'evv18407@gmail.com',
    },
  });
  const meeting = await checkRes.json();
  assert.equal(meeting.reminderSent, true);
  assert.equal(meeting.meetingUrl, testMeetingUrl);
});

