import assert from 'node:assert/strict';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.47.10';
import { assembleTranscript, coalesceRealtimeTranscriptSegments, handleCompletion } from '../functions/_shared/meeting-pipeline.ts';
import { elevenLabsTranscription } from '../functions/_shared/elevenlabs.ts';

const u = (speaker: string, text: string, start: number, step = 0.1) => ({
  speaker, speaker_id: speaker, text, start, end: start + text.split(' ').length * step,
  words: text.split(' ').map((word, i) => ({ word, speaker_id: speaker, start: start + i * step, end: start + (i + 1) * step, confidence: 0.97 })),
});
const input = (utterances: any[], speakers = ['Alice', 'Bob', 'Chloé']) => ({ speakers,
  transcription: { provider: 'gladia', result: { utterances } } });
const rows = (value: any) => value.turns.map((turn: any) => [turn.speaker, turn.text]);

for (const [description, pattern] of [
  ['A → B', ['Alice','Bob']],
  ['A → B → A → B rapid unpunctuated turns', ['Alice','Bob','Alice','Bob']],
  ['A → B → C → A → C → B', ['Alice','Bob','Chloé','Alice','Chloé','Bob']],
] as const) Deno.test(`speaker pattern ${description} retains every source token exactly once`, async () => {
  const source = pattern.map((speaker,i) => u(speaker,`turn ${i} spoken by ${speaker}`,i));
  const assembled = await assembleTranscript(input(source));
  assert.deepEqual(rows(assembled),source.map(turn => [turn.speaker,turn.text]));
  assert.equal(assembled.sourceWordCount,pattern.length * 5);
  assert.deepEqual(assembled.turns.map(turn=>turn.source_utterance_indices),source.map((_,i)=>[i]));
});

Deno.test('A → A → B → B → A merges adjacent same-speaker turns only with matching evidence', async () => {
  const source = [u('Alice','First sentence.',0),u('Alice','Second sentence.',0.4),u('Bob','First response.',1),u('Bob','Second response.',1.4),u('Alice','Follow up.',2)];
  const assembled = await assembleTranscript(input(source));
  assert.deepEqual(rows(assembled),[['Alice','First sentence. Second sentence.'],['Bob','First response. Second response.'],['Alice','Follow up.']]);
  assert.deepEqual(assembled.turns[0].source_utterance_indices,[0,1]);
  assert.equal(assembled.turns[0].words?.length,4);
});

Deno.test('multiple sentences stay in their provider utterance, then a short Yes and an interruption stay separate', async () => {
  const source=[u('Alice','Are you ready? We have two things to review.',0),u('Bob','Yes.',1),u('Alice',"Let's start.",1.2),u('Bob','Wait, I have a question.',1.5)];
  const assembled=await assembleTranscript(input(source));
  assert.deepEqual(rows(assembled),source.map(turn=>[turn.speaker,turn.text]));
  assert.equal(assembled.turns[1].words?.[0].start,1);
});

Deno.test('word-level speaker IDs split a falsely combined provider utterance without punctuation guessing', async () => {
  const combined={speaker:'Alice',text:'Are you ready Yes Lets start',words:[
    ...u('Alice','Are you ready',0).words,...u('Bob','Yes',0.4).words,...u('Alice','Lets start',0.6).words]};
  const assembled=await assembleTranscript(input([combined]));
  assert.deepEqual(rows(assembled),[['Alice','Are you ready'],['Bob','Yes'],['Alice','Lets start']]);
  assert.equal(assembled.turns.reduce((n,t)=>n+(t.words?.length||0),0),6);
});

Deno.test('requested weekly-update fixture: speaker boundaries repair structure without grammatical rewriting', async () => {
  const source=[
    u('Erva Savaliya','Hi Piyu, shall we start with the weekly update?',0),
    u('Piyu Savaliya','Yeah sure, I go first.',1),
    u('Piyu Savaliya','I completed the task we discussed last week and also fixed a few issues in the current model.',1.7),
    u('Piyu Savaliya','Thanks.',7),
    u('Erva Savaliya','Hello, am I audible?',8),
    u('Piyu Savaliya','No.',9),
    u('Erva Savaliya','Did you face any major problems?',9.2),
    u('Piyu Savaliya','There was a few issues with the IP API integration, but I managed to fix most of them.',10),
    u('Piyu Savaliya','One issue is still pending and I will work on it tomorrow.',12.2),
  ];
  const assembled=await assembleTranscript(input(source,['Erva Savaliya','Piyu Savaliya']));
  assert.deepEqual(rows(assembled),[
    ['Erva Savaliya',source[0].text],['Piyu Savaliya',`${source[1].text} ${source[2].text}`],
    ['Piyu Savaliya','Thanks.'],['Erva Savaliya','Hello, am I audible?'],['Piyu Savaliya','No.'],
    ['Erva Savaliya','Did you face any major problems?'],['Piyu Savaliya',`${source[7].text} ${source[8].text}`],
  ]);
  assert.ok(assembled.text.includes('There was a few issues'),'do not rewrite was to were');
  assert.equal(assembled.turns.reduce((n,t)=>n+(t.words?.length||0),0),source.reduce((n,t)=>n+t.words.length,0));
});

Deno.test('final real-time snapshots supersede partials; duplicates and simultaneous different speakers are handled independently', async () => {
  const event=(name:string,text:string,start:number,end:number,isFinal:boolean)=>({event:'transcript.segment',data:{speaker:{name},text,utteranceStart:start,utteranceEnd:end,isFinal}});
  const final=event('Alice','Hi Piyu, shall we start?',0,2,true);
  const events=[event('Alice','Hi Piyu',0,0.5,false),event('Alice','Hi Piyu, shall we',0,1,false),
    event('Bob','Yes.',0.7,0.9,true),final,final,
    event('Alice','Hi Piyu',0,0.5,false),event('Alice','Another utterance.',2,3,true)];
  const permanent=coalesceRealtimeTranscriptSegments(events);
  assert.equal(permanent.length,3);
  assert.equal(permanent.filter(t=>t.text==='Hi Piyu, shall we start?').length,1);
  assert.ok(permanent.some(t=>t.speaker==='Bob'&&t.text==='Yes.'));
  const assembled=await assembleTranscript({speakers:['Alice','Bob'],transcription:events});
  assert.equal(assembled.turns.flatMap(t=>t.text).filter(t=>t==='Hi Piyu, shall we start?').length,1);
  assert.ok(!assembled.text.includes('Hi Piyu\n'));
});

Deno.test('duplicate chunks and timed fragment suffixes are removed; genuine repeated phrases remain', async () => {
  const first=u('Bob','API integration but I fixed it',0);
  const suffix={...first,text:'but I fixed it tomorrow',start:0.2,end:0.8,words:[...first.words.slice(2),{word:'tomorrow',speaker_id:'Bob',start:0.7,end:0.8}]};
  const repeated=u('Bob',first.text,10);
  const source=[first,structuredClone(first),suffix,repeated];
  const raw=structuredClone(source);
  const assembled=await assembleTranscript(input(source));
  assert.deepEqual(source,raw,'raw source is never mutated');
  assert.deepEqual(rows(assembled),[['Bob',`${first.text} tomorrow`],['Bob',first.text]]);
  assert.equal(assembled.stats.duplicateUtterancesRemoved,1);assert.equal(assembled.stats.duplicateWordsRemoved,4);
});

Deno.test('overlapping named speakers retain separate utterances; unknown overlapping identities stay unassigned', async () => {
  const source=[u('Alice','I have an update.',0),u('Bob','Let me interrupt.',0.1)];
  const diarization=source.map(t=>JSON.stringify({speaker:t.speaker,start_time:0,end_time:1})).join('\n');
  const assembled=await assembleTranscript({...input(source),diarization});
  assert.deepEqual(rows(assembled),source.map(t=>[t.speaker,t.text]));
  assert.ok(assembled.turns.every(t=>t.contested));
  const anonymous=await assembleTranscript({...input([u('unknown','Ambiguous speech.',0.2)]),diarization});
  assert.equal(anonymous.turns[0].speaker,'Unidentified Speaker');assert.equal(anonymous.turns[0].contested,true);
});

Deno.test('long two-person speech conserves content and timestamps through safety segmentation', async () => {
  const source=[u('Alice',Array.from({length:180},(_,i)=>`Alice${i}`).join(' '),0),u('Bob',Array.from({length:180},(_,i)=>`Bob${i}`).join(' '),20)];
  const assembled=await assembleTranscript(input(source));
  assert.deepEqual(rows(assembled),source.map(t=>[t.speaker,t.text]));
  assert.equal(assembled.turns[1].end_time,source[1].end);assert.equal(assembled.turns.reduce((n,t)=>n+(t.words?.length||0),0),360);
});

Deno.test('participants joining/rejoining use explicit identities; anonymous IDs never become roster IDs by index', async () => {
  const source=[u('10','First participant.',0),u('20','New joiner.',1),u('30','Participant returned.',2)];
  const assembled=await assembleTranscript({participants:[{id:10,name:'Alice'},{id:20,name:'Bob'},{id:30,name:'Alice'}],transcription:source});
  assert.deepEqual(rows(assembled),[['Alice',source[0].text],['Bob',source[1].text],['Alice',source[2].text]]);
  const unmapped=await assembleTranscript({participants:[{id:0,name:'Alice'},{id:1,name:'Bob'}],transcription:[u('speaker_0','Unknown voice.',0),u('speaker_1','Another voice.',1)]});
  assert.deepEqual(unmapped.turns.map(t=>t.speaker),['Speaker 1','Speaker 2']);
});

Deno.test('Scribe cluster mapping stays stable across a stray coarse timeline interval and preserves acoustic boundaries', async () => {
  const words=Array.from({length:20},(_,i)=>({type:'word',text:`word${i}`,start:i*0.2,end:i*0.2+0.1,speaker_id:'speaker_0'}));
  const transcription=elevenLabsTranscription({text:words.map(w=>w.text).join(' '),words});
  const diarization=[{speaker:'Alice',start_time:0,end_time:4},{speaker:'Bob',start_time:1,end_time:1.11}].map(s=>JSON.stringify(s)).join('\n');
  const assembled=await assembleTranscript({speakers:['Alice','Bob'],transcription,diarization});
  assert.ok(assembled.turns.every(t=>t.speaker==='Alice'));
  assert.equal(assembled.turns.reduce((n,t)=>n+(t.words?.length||0),0),20);
  assert.equal(assembled.turns[0].source_speaker_id,'speaker_0');
  const conflict=await assembleTranscript({speakers:['Alice','Bob'],transcription,diarization:[
    {speaker:'Alice',start_time:0,end_time:2},{speaker:'Bob',start_time:2,end_time:4}].map(s=>JSON.stringify(s)).join('\n')});
  assert.ok(conflict.turns.every(t=>t.speaker==='Speaker 1'),'conflicting mappings retain numbered cluster instead of guessing');
});

Deno.test('Gemini receives only summary work and cannot edit even unidentified transcript turns', async () => {
  const old=Deno.env.get('GEMINI_API_KEY');const fetch=globalThis.fetch;
  Deno.env.set('GEMINI_API_KEY','test-key');
  const meeting:any={id:'00000000-0000-4000-8000-000000000001',status:'pending'};
  const source=input([u('unknown','I will finish it tomorrow.',0)],['Alice','Bob']);
  let calls=0;let snapshot:any;
  try {
    globalThis.fetch=async(url,init)=>{
      const path=new URL(String(url)).pathname;const body=init?.body?JSON.parse(String(init.body)):null;
      if(String(url).includes('generativelanguage.googleapis.com')){
        calls++;assert.ok(body.contents[0].parts[0].text.includes('analysing the complete'));
        assert.equal(meeting.transcript,'Unidentified Speaker: I will finish it tomorrow.');
        return Response.json({candidates:[{content:{parts:[{text:JSON.stringify({executive_summary:'A commitment was discussed.',action_items:[],corrections:[{index:0,speaker:'Alice'}]})}]}}]});
      }
      if(path.endsWith('/meeting_transcript_sources')){snapshot=body;return new Response(null,{status:201});}
      if(path.endsWith('/meetings')){
        if(init?.method==='GET')return Response.json([meeting]);
        if(body.context_status)return Response.json({code:'PGRST204',message:'Context unavailable in fixture'},{status:400});
        Object.assign(meeting,body);return Response.json([meeting]);
      }
      if(path.endsWith('/rpc/context_persist_action_items'))return new Response(null,{status:204});
      if(path.endsWith('/transcripts')||path.endsWith('/summaries'))return new Response(null,{status:init?.method==='DELETE'?204:201});
      throw new Error(`Unexpected API ${path}`);
    };
    const body={event:'bot.completed',data:source};
    await handleCompletion(createClient('https://quality.test','test-service'),body,source,'test-bot',meeting.id);
  } finally {
    globalThis.fetch=fetch;if(old===undefined)Deno.env.delete('GEMINI_API_KEY');else Deno.env.set('GEMINI_API_KEY',old);
  }
  assert.equal(calls,1);assert.deepEqual(snapshot.payload.standardized_transcription,source.transcription);
  assert.equal(meeting.transcript,'Unidentified Speaker: I will finish it tomorrow.');
});
