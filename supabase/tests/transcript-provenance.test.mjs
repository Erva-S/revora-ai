import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const id = '00000000-0000-4000-8000-000000000001';

test('raw transcript migration is additive and snapshots are append-only and service-scoped', async (t) => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      grant usage on schema public to anon,authenticated,service_role;
      create table public.meetings(id uuid primary key, transcript text, transcript_segments jsonb default '[]');`);
    await db.query('insert into meetings(id,transcript) values($1,$2)', [id, 'Existing transcript']);
    const migration = await readFile(new URL('../migrations/20261005010000_transcript_provenance.sql', import.meta.url), 'utf8');
    await db.exec(migration); await db.exec(migration);
    const asRole = (role, query, params = []) => db.transaction(async (tx) => {
      await tx.exec(`set local role ${role}`); return tx.query(query, params);
    });
    await t.test('existing transcript remains untouched', async () => {
      assert.equal((await db.query('select transcript from meetings')).rows[0].transcript, 'Existing transcript');
    });
    await t.test('duplicate payload hash is ignored while changed raw payloads are retained', async () => {
      const insert = (hash, payload) => asRole('service_role', `insert into meeting_transcript_sources(meeting_id,content_hash,provider,payload)
        values($1,$2,'elevenlabs',$3) on conflict(meeting_id,content_hash) do nothing`, [id, hash, payload]);
      await insert('first', { words: [{ text: 'Yes.', speaker_id: 'speaker_0', start: 1, end: 1.2, confidence: 0.97 }] });
      await insert('first', { words: [{ text: 'SHOULD NOT OVERWRITE' }] });
      await insert('second', { text: 'A new raw artifact' });
      const saved = await asRole('service_role', 'select payload from meeting_transcript_sources order by content_hash');
      assert.equal(saved.rows.length, 2);assert.equal(saved.rows[0].payload.words[0].text, 'Yes.');
      assert.equal(saved.rows[0].payload.words[0].speaker_id, 'speaker_0');
    });
    await t.test('service may read/insert but cannot update archived source content', async () => {
      await assert.rejects(asRole('service_role', "update meeting_transcript_sources set payload='{}'"), { code: '42501' });
    });
    await t.test('anon and authenticated cannot read the raw snapshot archive', async () => {
      for (const role of ['anon','authenticated'])
        await assert.rejects(asRole(role, 'select * from meeting_transcript_sources'), { code: '42501' });
    });
    await t.test('meeting deletion cascades archive deletion', async () => {
      await db.query('delete from meetings where id=$1', [id]);
      assert.equal((await db.query('select count(*)::int n from meeting_transcript_sources')).rows[0].n, 0);
    });
  } finally { await db.close(); }
});
