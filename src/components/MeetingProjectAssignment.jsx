import React, { useCallback, useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';

export default function MeetingProjectAssignment({ meeting, onAssigned }) {
  const [projects, setProjects] = useState([]);
  const [clients, setClients] = useState([]);
  const [clientId, setClientId] = useState('');
  const [clientName, setClientName] = useState('');
  const [projectName, setProjectName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const available = Object.prototype.hasOwnProperty.call(meeting, 'project_id');
  const load = useCallback(async () => {
    if (!available) return;
    const [p, c] = await Promise.all([
      supabase.from('projects').select('id,name,clients(name)').order('name'),
      supabase.from('clients').select('id,name').order('name'),
    ]);
    if (p.error || c.error) { setError('Projects are unavailable. Check the context migration and your admin access.'); return; }
    setProjects(p.data || []); setClients(c.data || []);
  }, [available]);
  useEffect(() => { const timer = setTimeout(load, 0); return () => clearTimeout(timer); }, [load]);

  const assign = async (projectId) => {
    const { data, error: updateError } = await supabase.from('meetings').update({ project_id: projectId || null })
      .eq('id', meeting.id).select('*').single();
    if (updateError) throw updateError;
    onAssigned(data);
  };
  const changeProject = async (projectId) => {
    setBusy(true); setError('');
    try { await assign(projectId); } catch (err) { setError(err.message || 'Project assignment failed.'); }
    finally { setBusy(false); }
  };
  const createProject = async (e) => {
    e.preventDefault(); setBusy(true); setError('');
    try {
      const { data: session } = await supabase.auth.getSession();
      const createdBy = session.session?.user?.id || null;
      let chosen = clientId;
      if (!chosen) {
        const result = await supabase.from('clients').insert({ name: clientName.trim(), created_by: createdBy }).select('id').single();
        if (result.error) throw result.error;
        chosen = result.data.id; setClientId(chosen); setClientName('');
      }
      const result = await supabase.from('projects').insert({ client_id: chosen, name: projectName.trim(), created_by: createdBy }).select('id').single();
      if (result.error) throw result.error;
      await assign(result.data.id); setProjectName('');
    } catch (err) { setError(err.message || 'Could not create client/project.'); }
    finally { await load(); setBusy(false); }
  };

  return <section className="p-3.5 rounded-xl border border-slate-200 bg-slate-50 space-y-2 text-xs">
    <label className="block font-bold text-slate-700">Project
      <select value={meeting.project_id || ''} disabled={busy || !available} onChange={(e) => changeProject(e.target.value)}
        className="mt-1 w-full p-2 rounded-lg border border-slate-200 bg-white font-normal">
        <option value="">No project assigned</option>
        {projects.map((p) => <option key={p.id} value={p.id}>{p.clients?.name} / {p.name}</option>)}
      </select>
    </label>
    {!available && <p className="text-slate-500">Project assignment is available after the context migration.</p>}
    {error && <p role="alert" className="text-amber-800">{error}</p>}
    {available && <details><summary className="font-semibold text-[#0084FF] cursor-pointer">Create client / project</summary>
      <form onSubmit={createProject} className="mt-2 space-y-2">
        <label className="block">Client
          <select value={clientId} onChange={(e) => setClientId(e.target.value)} disabled={busy} className="block mt-1 w-full p-2 rounded-lg border border-slate-200 bg-white">
            <option value="">Create a new client</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        {!clientId && <input aria-label="New client name" placeholder="Client name" value={clientName} onChange={(e) => setClientName(e.target.value)}
          maxLength={200} required disabled={busy} className="w-full p-2 rounded-lg border border-slate-200 bg-white" />}
        <input aria-label="New project name" placeholder="Project name" value={projectName} onChange={(e) => setProjectName(e.target.value)}
          maxLength={200} required disabled={busy} className="w-full p-2 rounded-lg border border-slate-200 bg-white" />
        <button type="submit" disabled={busy || !projectName.trim() || (!clientId && !clientName.trim())}
          className="px-3 py-2 rounded-lg bg-[#0084FF] text-white font-bold disabled:opacity-50 cursor-pointer">{busy ? 'Saving…' : 'Create project & assign'}</button>
      </form>
    </details>}
  </section>;
}
