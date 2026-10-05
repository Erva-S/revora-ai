// Real PostgreSQL via isolated PGlite. Set PGLITE_MODULE to an installed module.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

test('ElevenLabs migration: durable single-job ownership, service-only access, lease and cascade', async (t) => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      grant usage on schema public to anon, authenticated, service_role;
      create table public.meetings(id uuid primary key, transcription_provider text);`);
    const migration = await readFile(new URL('../migrations/20261005000000_elevenlabs_transcription.sql', import.meta.url), 'utf8');
    await db.exec(migration);
    await db.query('insert into meetings(id) values($1)', [id(1)]);
    const asRole = (role, sql, params = []) => db.transaction(async (tx) => {
      await tx.exec(`set local role ${role}`);
      return tx.query(sql, params);
    });
    await t.test('service role can create a job; migration rerun preserves it', async () => {
      await asRole('service_role', `insert into meeting_transcription_jobs(id,meeting_id,model,input_payload)
        values($1,$2,'scribe_v2','{}')`, [id(2), id(1)]);
      await db.exec(migration);
      assert.equal((await db.query('select count(*)::int n from meeting_transcription_jobs')).rows[0].n, 1);
      assert.equal((await db.query("select relrowsecurity from pg_class where relname='meeting_transcription_jobs'")).rows[0].relrowsecurity, true);
    });
    await t.test('anon and authenticated users cannot read or alter raw jobs', async () => {
      for (const role of ['anon', 'authenticated']) {
        await assert.rejects(asRole(role, 'select * from meeting_transcription_jobs'), { code: '42501' });
        await assert.rejects(asRole(role, "update meeting_transcription_jobs set result='{}'"), { code: '42501' });
      }
    });
    await t.test('duplicate meeting jobs and invalid states are rejected', async () => {
      await assert.rejects(asRole('service_role', `insert into meeting_transcription_jobs(meeting_id,model,input_payload)
        values($1,'scribe_v2','{}')`, [id(1)]), { code: '23505' });
      await assert.rejects(asRole('service_role', "update meeting_transcription_jobs set status='invented'"), { code: '23514' });
    });
    await t.test('one ready result is claimed only once', async () => {
      await asRole('service_role', "update meeting_transcription_jobs set status='ready',result='{}'");
      const claim = () => asRole('service_role', "update meeting_transcription_jobs set status='processing' where id=$1 and status='ready' returning id", [id(2)]);
      assert.equal((await claim()).rows.length, 1);
      assert.equal((await claim()).rows.length, 0);
    });
    await t.test('deleting a meeting deletes its raw transcription job', async () => {
      await db.query('delete from meetings where id=$1', [id(1)]);
      assert.equal((await db.query('select count(*)::int n from meeting_transcription_jobs')).rows[0].n, 0);
    });
  } finally { await db.close(); }
});
