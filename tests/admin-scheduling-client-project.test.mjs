import test from 'node:test';
import assert from 'node:assert/strict';

const API_BASE = 'http://localhost:5000/api/briefings';

const CLIENT_ERVA_ID = '627d5630-cd92-4b38-a7db-3d265cfd2f45';
const PROJECT_FULLSTACK_ID = '62131ea3-fb3a-482b-b49b-062190765c80'; // Belongs to Erva
const CLIENT_ACME_ID = 'e0d75509-f88c-407a-8701-f271bbaa0000';
const PROJECT_ACME_AI_ID = '11111111-2222-3333-4444-555555555555'; // Belongs to Acme

test('1. Non-admin cannot schedule meetings (Authorization rejection with 403)', async () => {
  const res = await fetch(API_BASE, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-user-role': 'user',
      'x-user-email': 'regular_user@example.com',
      'x-user-id': 'regular-user-id',
    },
    body: JSON.stringify({
      title: 'Unauthorized Meeting Attempt',
      clientId: CLIENT_ERVA_ID,
      projectId: PROJECT_FULLSTACK_ID,
    }),
  });

  assert.equal(res.status, 403);
  const data = await res.json();
  assert.match(data.error, /Only administrators can schedule meetings/i);
});

test('2. Backend rejects scheduling request when Client is missing (400)', async () => {
  const res = await fetch(API_BASE, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-user-role': 'admin',
      'x-user-email': 'evv18407@gmail.com',
    },
    body: JSON.stringify({
      title: 'Missing Client Meeting',
      projectId: PROJECT_FULLSTACK_ID,
    }),
  });

  assert.equal(res.status, 400);
  const data = await res.json();
  assert.match(data.error, /Client selection is required/i);
});

test('3. Backend rejects scheduling request when Project is missing (400)', async () => {
  const res = await fetch(API_BASE, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-user-role': 'admin',
      'x-user-email': 'evv18407@gmail.com',
    },
    body: JSON.stringify({
      title: 'Missing Project Meeting',
      clientId: CLIENT_ERVA_ID,
    }),
  });

  assert.equal(res.status, 400);
  const data = await res.json();
  assert.match(data.error, /Project selection is required/i);
});

test('4. Backend rejects mismatched Client and Project pair (400)', async () => {
  // Erva client paired with Acme Corp project
  const res = await fetch(API_BASE, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-user-role': 'admin',
      'x-user-email': 'evv18407@gmail.com',
    },
    body: JSON.stringify({
      title: 'Mismatched Relationship Meeting',
      clientId: CLIENT_ERVA_ID,
      projectId: PROJECT_ACME_AI_ID,
    }),
  });

  assert.equal(res.status, 400);
  const data = await res.json();
  assert.match(data.error, /The selected project does not belong to the selected client/i);
});

test('5. Admin schedules meeting with valid Client-Project pair (201 & persistence)', async () => {
  const scheduledTime = new Date(Date.now() + 86400000).toISOString();
  const res = await fetch(API_BASE, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-user-role': 'admin',
      'x-user-email': 'evv18407@gmail.com',
    },
    body: JSON.stringify({
      title: 'Sprint Planning & Release Review',
      clientId: CLIENT_ERVA_ID,
      projectId: PROJECT_FULLSTACK_ID,
      recipientEmail: 'devteam@erva.io',
      agenda: 'Review sprint deliverables and client deployment schedule.',
      scheduledAt: scheduledTime,
    }),
  });

  assert.equal(res.status, 201);
  const data = await res.json();
  assert.ok(data.id, 'Meeting must have a valid persisted id');
  assert.equal(data.clientId, CLIENT_ERVA_ID);
  assert.equal(data.clientName, 'Erva');
  assert.equal(data.projectId, PROJECT_FULLSTACK_ID);
  assert.equal(data.projectName, 'full stack dev');
  assert.equal(data.title, 'Sprint Planning & Release Review');

  // Verify retrieval via GET /api/briefings/:id
  const getRes = await fetch(`${API_BASE}/${data.id}`, {
    headers: {
      'x-user-role': 'admin',
      'x-user-email': 'evv18407@gmail.com',
    },
  });
  assert.equal(getRes.status, 200);
  const fetched = await getRes.json();
  assert.equal(fetched.clientId, CLIENT_ERVA_ID);
  assert.equal(fetched.clientName, 'Erva');
  assert.equal(fetched.projectId, PROJECT_FULLSTACK_ID);
  assert.equal(fetched.projectName, 'full stack dev');
});

test('6. Multi-tenant client isolation: Client A cannot see or access Client B meetings', async () => {
  // First create a meeting explicitly for Erva
  const createRes = await fetch(API_BASE, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-user-role': 'admin',
      'x-user-email': 'evv18407@gmail.com',
    },
    body: JSON.stringify({
      title: 'Confidential Erva Strategy Session',
      clientId: CLIENT_ERVA_ID,
      projectId: PROJECT_FULLSTACK_ID,
      recipientEmail: 'erva.executive@erva.io',
      agenda: 'Private client financial model review.',
    }),
  });
  assert.equal(createRes.status, 201);
  const ervaMeeting = await createRes.json();

  // Acme client lists briefings
  const listRes = await fetch(API_BASE, {
    headers: {
      'x-user-role': 'client',
      'x-user-email': 'admin@acme.com',
      'x-user-id': 'acme-user-id-99',
      'x-client-id': CLIENT_ACME_ID,
    },
  });
  assert.equal(listRes.status, 200);
  const acmeBriefings = await listRes.json();
  const leakedErvaMeeting = acmeBriefings.find((m) => m.id === ervaMeeting.id);
  assert.equal(leakedErvaMeeting, undefined, 'Acme client must never see Erva meeting in briefing list');

  // Acme client attempts direct access by meeting ID
  const directRes = await fetch(`${API_BASE}/${ervaMeeting.id}`, {
    headers: {
      'x-user-role': 'client',
      'x-user-email': 'admin@acme.com',
      'x-user-id': 'acme-user-id-99',
      'x-client-id': CLIENT_ACME_ID,
    },
  });
  assert.equal(directRes.status, 403, 'Direct access to another client meeting must return 403 Access Denied');

  // Erva client lists briefings
  const ervaListRes = await fetch(API_BASE, {
    headers: {
      'x-user-role': 'client',
      'x-user-email': 'lead@erva.io',
      'x-user-id': 'erva-user-id-1',
      'x-client-id': CLIENT_ERVA_ID,
    },
  });
  assert.equal(ervaListRes.status, 200);
  const ervaBriefings = await ervaListRes.json();
  const foundErvaMeeting = ervaBriefings.find((m) => m.id === ervaMeeting.id);
  assert.ok(foundErvaMeeting, 'Erva client must see her scheduled meeting');
  assert.equal(foundErvaMeeting.clientName, 'Erva');
  assert.equal(foundErvaMeeting.projectName, 'full stack dev');
});
