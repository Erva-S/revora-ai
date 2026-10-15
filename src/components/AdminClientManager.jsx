import React, { useState, useEffect } from 'react';
import { supabase } from '../supabaseClient';
import { 
  Building2, Plus, Users, FolderGit2, Video, Key, 
  Copy, Check, ShieldCheck, Mail, Lock, RefreshCw, 
  AlertCircle, ChevronRight, Sparkles, X, ExternalLink
} from 'lucide-react';

export default function AdminClientManager({ onClientCreated }) {
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [createdCredentials, setCreatedCredentials] = useState(null);
  const [copied, setCopied] = useState(false);

  // Form State
  const [clientName, setClientName] = useState('');
  const [contactName, setContactName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [company, setCompany] = useState('');
  const [password, setPassword] = useState('');

  // Project Quick Add Modal
  const [quickProjectClient, setQuickProjectClient] = useState(null);
  const [quickProjectName, setQuickProjectName] = useState('');
  const [submittingProject, setSubmittingProject] = useState(false);

  const fetchClients = async () => {
    try {
      setLoading(true);
      setError(null);
      const { data, error: rpcError } = await supabase.rpc('admin_list_clients');
      if (rpcError) {
        // Fallback to direct table query
        const { data: fallbackData, error: fbError } = await supabase
          .from('clients')
          .select('id, name, email, contact_name, company, status, created_at')
          .order('created_at', { ascending: false });
        if (fbError) throw fbError;
        setClients(fallbackData || []);
      } else {
        setClients(data || []);
      }
    } catch (err) {
      console.warn('Failed to load clients list:', err);
      setError(err.message || 'Unable to load clients.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchClients();
  }, []);

  const generateStrongPassword = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%^&*';
    let res = '';
    for (let i = 0; i < 14; i++) {
      res += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    setPassword(res);
  };

  const handleCreateClient = async (e) => {
    e.preventDefault();
    if (!clientName.trim() || !contactEmail.trim()) {
      alert('Client Name and Contact Email are required.');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const finalPassword = password.trim() || 'RevoraClient2026!';
      const { data, error: provisionError } = await supabase.rpc('admin_provision_client', {
        p_client_name: clientName.trim(),
        p_contact_email: contactEmail.trim().toLowerCase(),
        p_contact_name: contactName.trim() || clientName.trim(),
        p_password: finalPassword,
        p_company: company.trim() || clientName.trim()
      });

      if (provisionError) throw provisionError;

      setCreatedCredentials({
        clientName: clientName.trim(),
        contactName: contactName.trim() || clientName.trim(),
        email: contactEmail.trim().toLowerCase(),
        password: finalPassword,
      });

      // Reset form
      setClientName('');
      setContactName('');
      setContactEmail('');
      setCompany('');
      setPassword('');

      fetchClients();
      if (onClientCreated) onClientCreated(data);
    } catch (err) {
      console.error('Provisioning error:', err);
      setError(err.message || 'Failed to create client account.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCreateProject = async (e) => {
    e.preventDefault();
    if (!quickProjectClient || !quickProjectName.trim()) return;

    setSubmittingProject(true);
    try {
      const { data: session } = await supabase.auth.getSession();
      const currentUserId = session?.session?.user?.id || null;

      const { error: pError } = await supabase.from('projects').insert({
        client_id: quickProjectClient.id,
        name: quickProjectName.trim(),
        created_by: currentUserId,
      });

      if (pError) throw pError;

      setQuickProjectClient(null);
      setQuickProjectName('');
      fetchClients();
      if (onClientCreated) onClientCreated();
    } catch (err) {
      alert(err.message || 'Failed to create project for client');
    } finally {
      setSubmittingProject(false);
    }
  };

  const copyCredentialsText = () => {
    if (!createdCredentials) return;
    const text = `Revora Client Portal Credentials:\nPortal URL: ${window.location.origin}/login\nEmail: ${createdCredentials.email}\nTemporary Password: ${createdCredentials.password}`;
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  return (
    <div className="p-5 sm:p-6 rounded-2xl bg-white border border-slate-200/80 shadow-xs space-y-5">
      {/* Header & Action Button */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-100">
        <div>
          <div className="flex items-center gap-2">
            <span className="w-8 h-8 rounded-xl bg-blue-50 text-[#0084FF] flex items-center justify-center shadow-2xs">
              <Building2 className="w-4 h-4" />
            </span>
            <h3 className="font-outfit font-bold text-lg text-slate-900">
              Client Organizations & Portals
            </h3>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Create dynamic client accounts with dedicated portals, credentials, and isolated data.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={fetchClients}
            disabled={loading}
            className="p-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 transition-colors cursor-pointer"
            title="Refresh client list"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-[#0084FF]' : ''}`} />
          </button>

          <button
            onClick={() => {
              setIsModalOpen(true);
              setCreatedCredentials(null);
              generateStrongPassword();
            }}
            className="px-4 py-2.5 rounded-xl bg-[#0084FF] hover:bg-[#0074E0] text-white font-bold text-xs flex items-center gap-2 transition-all shadow-xs cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Create New Client</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="p-3.5 rounded-xl bg-red-50 border border-red-200 text-red-600 text-xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />
            <span>{error}</span>
          </div>
          <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Clients Cards / Table */}
      {loading && clients.length === 0 ? (
        <div className="py-12 flex flex-col items-center justify-center gap-3 text-slate-400">
          <RefreshCw className="w-6 h-6 animate-spin text-[#0084FF]" />
          <span className="text-xs font-mono">Loading client directory...</span>
        </div>
      ) : clients.length === 0 ? (
        <div className="py-12 px-4 rounded-xl border border-dashed border-slate-200 text-center space-y-2">
          <Building2 className="w-8 h-8 text-slate-300 mx-auto" />
          <div className="text-sm font-bold text-slate-700">No client organizations yet</div>
          <p className="text-xs text-slate-400 max-w-sm mx-auto">
            Click "Create New Client" to provision an isolated organization account (e.g. Erva) with their own portal login.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {clients.map((c) => (
            <div
              key={c.id}
              className="p-4 rounded-xl border border-slate-200/90 bg-slate-50/50 hover:bg-white hover:border-[#0084FF]/40 hover:shadow-sm transition-all flex flex-col justify-between space-y-3"
            >
              <div>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-slate-900 to-slate-700 text-white flex items-center justify-center font-bold text-sm shadow-2xs">
                      {(c.name || 'C').charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <h4 className="font-bold text-sm text-slate-900 leading-tight">
                        {c.name}
                      </h4>
                      <span className="text-[11px] text-slate-500">
                        {c.company || 'Organization'}
                      </span>
                    </div>
                  </div>

                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                    Active Client
                  </span>
                </div>

                <div className="mt-3.5 space-y-1.5 text-xs text-slate-600">
                  <div className="flex items-center gap-2">
                    <Mail className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <span className="truncate font-mono text-[11px] text-slate-700">
                      {c.email || c.user_email || 'No email registered'}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <Users className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <span className="text-[11px]">
                      Contact: <span className="font-semibold text-slate-800">{c.contact_name || c.user_full_name || 'Primary User'}</span>
                    </span>
                  </div>
                </div>
              </div>

              {/* Metrics & Actions */}
              <div className="pt-3 border-t border-slate-200/60 flex items-center justify-between text-[11px]">
                <div className="flex items-center gap-3 text-slate-500">
                  <span className="flex items-center gap-1" title="Projects count">
                    <FolderGit2 className="w-3 h-3 text-[#0084FF]" />
                    <strong className="text-slate-800">{c.project_count ?? '—'}</strong> projects
                  </span>
                  <span className="flex items-center gap-1" title="Meetings count">
                    <Video className="w-3 h-3 text-emerald-600" />
                    <strong className="text-slate-800">{c.meeting_count ?? '—'}</strong> meetings
                  </span>
                </div>

                <button
                  onClick={() => {
                    setQuickProjectClient(c);
                    setQuickProjectName('');
                  }}
                  className="px-2 py-1 rounded-lg bg-white border border-slate-200 hover:border-[#0084FF] text-[#0084FF] font-bold text-[10px] transition-colors cursor-pointer"
                >
                  + Add Project
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* MODAL 1: Create Client Account */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs">
          <div className="w-full max-w-[500px] bg-white rounded-2xl border border-slate-200 shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            {/* Modal Header */}
            <div className="px-6 py-4 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-[#0084FF] text-white flex items-center justify-center shadow-2xs">
                  <Building2 className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-outfit font-bold text-base text-slate-900 leading-tight">
                    Provision New Client Portal
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    Registers client profile and authenticates their isolated workspace.
                  </p>
                </div>
              </div>

              <button
                onClick={() => setIsModalOpen(false)}
                className="w-7 h-7 rounded-full bg-slate-200/60 hover:bg-slate-200 flex items-center justify-center text-slate-600 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6">
              {createdCredentials ? (
                /* Success View: Show Credentials Card */
                <div className="space-y-4">
                  <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 space-y-2">
                    <div className="flex items-center gap-2 text-emerald-800 font-bold text-sm">
                      <Check className="w-4 h-4 text-emerald-600" />
                      <span>Client Account Created Successfully!</span>
                    </div>
                    <p className="text-xs text-emerald-800/90 leading-relaxed">
                      Client <strong>{createdCredentials.clientName}</strong> is provisioned. They can now log in via the <strong>Client Login</strong> tab using these credentials:
                    </p>
                  </div>

                  <div className="p-4 rounded-xl bg-slate-900 text-white font-mono text-xs space-y-2 relative">
                    <div>
                      <span className="text-slate-400">Portal: </span>
                      <span className="text-sky-300">{window.location.origin}/login</span>
                    </div>
                    <div>
                      <span className="text-slate-400">Client Email: </span>
                      <span className="text-emerald-300">{createdCredentials.email}</span>
                    </div>
                    <div>
                      <span className="text-slate-400">Password: </span>
                      <span className="text-amber-300 font-bold">{createdCredentials.password}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 pt-2">
                    <button
                      onClick={copyCredentialsText}
                      className="flex-1 py-2.5 px-4 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold text-xs flex items-center justify-center gap-2 cursor-pointer transition-colors"
                    >
                      {copied ? (
                        <>
                          <Check className="w-4 h-4 text-emerald-600" />
                          <span>Copied to Clipboard!</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-4 h-4 text-slate-600" />
                          <span>Copy Credentials</span>
                        </>
                      )}
                    </button>

                    <button
                      onClick={() => setIsModalOpen(false)}
                      className="py-2.5 px-5 rounded-xl bg-[#0084FF] hover:bg-[#0074E0] text-white font-bold text-xs cursor-pointer shadow-xs"
                    >
                      Done
                    </button>
                  </div>
                </div>
              ) : (
                /* Form View */
                <form onSubmit={handleCreateClient} className="space-y-4">
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-1">
                      Client / Organization Name *
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Erva"
                      value={clientName}
                      onChange={(e) => setClientName(e.target.value)}
                      className="w-full px-3.5 py-2 rounded-xl border border-slate-200 focus:outline-none focus:border-[#0084FF] text-xs font-medium text-slate-900 bg-white"
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-1">
                        Contact Person Name
                      </label>
                      <input
                        type="text"
                        placeholder="e.g. Erva Savaliya"
                        value={contactName}
                        onChange={(e) => setContactName(e.target.value)}
                        className="w-full px-3.5 py-2 rounded-xl border border-slate-200 focus:outline-none focus:border-[#0084FF] text-xs font-medium text-slate-900 bg-white"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-1">
                        Company / Entity
                      </label>
                      <input
                        type="text"
                        placeholder="e.g. Erva Enterprises"
                        value={company}
                        onChange={(e) => setCompany(e.target.value)}
                        className="w-full px-3.5 py-2 rounded-xl border border-slate-200 focus:outline-none focus:border-[#0084FF] text-xs font-medium text-slate-900 bg-white"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-1">
                      Client Login Email *
                    </label>
                    <input
                      type="email"
                      required
                      placeholder="e.g. erva@client.revora.ai"
                      value={contactEmail}
                      onChange={(e) => setContactEmail(e.target.value)}
                      className="w-full px-3.5 py-2 rounded-xl border border-slate-200 focus:outline-none focus:border-[#0084FF] text-xs font-medium text-slate-900 bg-white"
                    />
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-[11px] font-bold text-slate-700 uppercase tracking-wider">
                        Initial Account Password
                      </label>
                      <button
                        type="button"
                        onClick={generateStrongPassword}
                        className="text-[10px] font-bold text-[#0084FF] hover:underline flex items-center gap-1 cursor-pointer"
                      >
                        <Sparkles className="w-3 h-3" />
                        Generate Strong Password
                      </button>
                    </div>
                    <div className="relative">
                      <input
                        type="text"
                        placeholder="Enter or generate password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="w-full px-3.5 py-2 rounded-xl border border-slate-200 focus:outline-none focus:border-[#0084FF] text-xs font-mono text-slate-900 bg-white"
                      />
                    </div>
                  </div>

                  <div className="pt-2 flex items-center justify-end gap-2.5">
                    <button
                      type="button"
                      onClick={() => setIsModalOpen(false)}
                      className="py-2.5 px-4 rounded-xl text-slate-600 hover:bg-slate-100 font-bold text-xs cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={submitting}
                      className="py-2.5 px-5 rounded-xl bg-[#0084FF] hover:bg-[#0074E0] text-white font-bold text-xs flex items-center gap-2 cursor-pointer shadow-xs disabled:opacity-50"
                    >
                      {submitting ? (
                        <>
                          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                          <span>Creating Client...</span>
                        </>
                      ) : (
                        <span>Create Client Account</span>
                      )}
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>
        </div>
      )}

      {/* MODAL 2: Quick Create Project for Client */}
      {quickProjectClient && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs">
          <div className="w-full max-w-[420px] bg-white rounded-2xl border border-slate-200 shadow-2xl p-6 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="font-outfit font-bold text-base text-slate-900">
                Add Project for {quickProjectClient.name}
              </h3>
              <button
                onClick={() => setQuickProjectClient(null)}
                className="w-6 h-6 rounded-full bg-slate-100 flex items-center justify-center text-slate-500 hover:text-slate-800"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            <form onSubmit={handleCreateProject} className="space-y-4">
              <div>
                <label className="block text-[11px] font-bold text-slate-700 uppercase mb-1">
                  Project Name
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Mobile App Redesign"
                  value={quickProjectName}
                  onChange={(e) => setQuickProjectName(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-xl border border-slate-200 focus:outline-none focus:border-[#0084FF] text-xs font-medium text-slate-900"
                />
              </div>

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setQuickProjectClient(null)}
                  className="py-2 px-3 text-xs text-slate-500 hover:text-slate-800 font-bold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingProject}
                  className="py-2 px-4 rounded-xl bg-[#0084FF] hover:bg-[#0074E0] text-white font-bold text-xs disabled:opacity-50"
                >
                  {submittingProject ? 'Creating...' : 'Create Project'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
