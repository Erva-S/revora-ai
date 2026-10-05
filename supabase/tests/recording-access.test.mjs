import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');

test('recording migration preserves meetings and blocks old ownerless/public recording exposure', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; grant usage on schema public,auth to anon,authenticated,service_role;
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
      create function public.is_admin() returns boolean language sql stable as $$select current_setting('test.admin',true)='true'$$;
      create table meetings(id uuid primary key,user_id uuid,bot_id uuid,recording_url text,transcript text);
      grant select,insert,update on meetings to anon,authenticated,service_role;
      alter table meetings enable row level security;
      create policy old_public on meetings for select to anon,authenticated using(true);
      insert into meetings values('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002',null,'https://expired.test','Original transcript');
      insert into meetings values('00000000-0000-4000-8000-000000000003',null,null,'https://legacy.test','Legacy transcript');`);
    const migration = await readFile(new URL('../migrations/20261005020000_recording_access.sql', import.meta.url), 'utf8');
    await db.exec(migration); await db.exec(migration);
    const visible = (role, uid = '', admin = 'false') => db.transaction(async (tx) => {
      await tx.exec(`set local role ${role}`);
      await tx.query("select set_config('test.uid',$1,true),set_config('test.admin',$2,true)", [uid, admin]);
      return (await tx.query('select * from meetings order by id')).rows;
    });
    assert.equal((await visible('anon')).length, 0);
    assert.equal((await visible('authenticated', '00000000-0000-4000-8000-000000000004')).length, 0);
    const owner = await visible('authenticated', '00000000-0000-4000-8000-000000000002');
    assert.equal(owner.length, 1); assert.equal(owner[0].transcript, 'Original transcript'); assert.deepEqual(owner[0].recording_metadata, {});
    assert.equal((await visible('authenticated', '00000000-0000-4000-8000-000000000004', 'true')).length, 2);
    assert.equal((await visible('service_role')).length, 2);
    await assert.rejects(db.exec("update meetings set recording_status='fake-ready'"), { code: '23514' });
  } finally { await db.close(); }
});
