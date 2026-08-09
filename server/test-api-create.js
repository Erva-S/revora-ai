async function testCreateMeeting() {
  const meetingTime = new Date(Date.now() + 30 * 60 * 1000).toISOString(); // 30 minutes from now

  const response = await fetch('http://localhost:5000/api/meetings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: 'Strategy Meeting with Frontend',
      startTime: meetingTime,
      recipientEmail: 'client@example.com'
    })
  });

  const data = await response.json();
  console.log('API Response:', data);
}

testCreateMeeting();