import test from 'node:test';
import assert from 'node:assert/strict';
import { transcriptDisplayText, transcriptParagraphs } from '../../src/lib/transcriptDisplay.js';

test('structured speaker turns are rendered as paragraphs without speaker inference or merging', () => {
  const meeting = { transcript: 'Stale combined display text', transcript_segments: [
    { speaker: 'Alice', text: 'Are you ready?' }, { speaker: 'Bob', text: 'Yes.' }, { speaker: 'Alice', text: "Let's start." },
  ] };
  assert.equal(transcriptDisplayText(meeting), "Alice: Are you ready?\n\nBob: Yes.\n\nAlice: Let's start.");
  assert.equal(transcriptParagraphs(meeting).length, 3);
});

test('legacy transcript rows remain readable and are never assigned new speaker names', () => {
  assert.equal(transcriptDisplayText({ transcript: 'Speaker 1: An unknown voice.\nBob: Hello.\n' }), 'Speaker 1: An unknown voice.\n\nBob: Hello.');
  assert.equal(transcriptDisplayText({}), '');
});
