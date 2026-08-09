import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../supabaseClient';
import { ShieldCheck, LogOut, Users, Database, RefreshCw, Lock, Check, Trash2, Calendar, Mail, Send, ShieldAlert, ArrowLeft, Clock } from 'lucide-react';

export default function AdminDashboard({ onNavigateHome }) {
  const { user, logout } = useAuth();
  const [usersList, setUsersList] = useState([]);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [actionMessage, setActionMessage] = useState(null);

  // New Meeting Form States
  const [meetingTitle, setMeetingTitle] = useState('');
  const [recipientEmail, setRecipientEmail] = useState('');
  const [meetingDetails, setMeetingDetails] = useState('');
  const [scheduledAt, setScheduledAt] = useState(''); // State for scheduled date & time
  const [creatingMeeting, setCreatingMeeting] = useState(false);

  // Fetch users list directly from Supabase profiles table
  const fetchUsers = async () => {
    try {
      setLoadingUsers(true);
      const { data: profiles, error } = await supabase
        .from('profiles')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;

      if (profiles) {
        setUsersList(
          profiles.map((p) => ({
            id: p.id,
            email: p.email,
            name: p.full_name || p.email?.split('@')[0] || 'User',
            role: p.role || 'user',
            avatar: p.avatar_url,
            googleId: null,
            createdAt: p.created_at,
          }))
        );
      }
    } catch (err) {
      console.error('Failed to fetch users list from Supabase:', err);
    } finally {
      setLoadingUsers(false);
    }
  };

  useEffect(() => {
    if (user && user.role === 'admin') {
      fetchUsers();
    }
  }, [user]);

  // Handle Create & Dispatch Scheduled Meeting Briefing
  const handleCreateMeeting = async (e) => {
    e.preventDefault();
    if (!meetingTitle || !recipientEmail || !scheduledAt) {
      alert('Please fill out the meeting title, attendee email, and scheduled date/time.');
      return;
    }

    setCreatingMeeting(true);
    setActionMessage(null);

    try {
      const res = await fetch('http://localhost:5000/api/meetings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: meetingTitle,
          recipientEmail: recipientEmail,
          details: meetingDetails,
          scheduledAt: scheduledAt, // Send scheduled timestamp to backend
        }),
      });

      const data = await res.json();

      if (res.ok) {
        if (data.publishedNow) {
          setActionMessage(`Meeting scheduled! Starting within 1 hour—AI briefing generated and emailed immediately to ${recipientEmail}.`);
        } else {
          setActionMessage(`Meeting scheduled for ${new Date(scheduledAt).toLocaleString()}! Briefing and email will automatically dispatch 1 hour before start time.`);
        }

        setMeetingTitle('');
        setRecipientEmail('');
        setMeetingDetails('');
        setScheduledAt('');
        setTimeout(() => setActionMessage(null), 6000);
      } else {
        alert(data.error || 'Failed to schedule meeting.');
      }
    } catch (err) {
      console.error('Error creating meeting:', err);
      alert('Server connection error. Ensure node index.js is active on port 5001.');
    } finally {
      setCreatingMeeting(false);
    }
  };

  // Toggle user role in Supabase profiles
  const handleToggleRole = async (targetUserId, currentRole) => {
    const newRole = currentRole === 'admin' ? 'user' : 'admin';
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ role: newRole })
        .eq('id', targetUserId);

      if (error) throw error;

      setActionMessage(`User role updated to "${newRole.toUpperCase()}"`);
      fetchUsers();
      setTimeout(() => setActionMessage(null), 3000);
    } catch (err) {
      console.error('Failed to update role:', err);
      alert(err.message || 'Failed to update user role');
    }
  };

  // Delete user profile from Supabase
  const handleDeleteUser = async (targetUserId) => {
    if (!window.confirm('Are you sure you want to delete this user profile?')) return;
    try {
      const { error } = await supabase
        .from('profiles')
        .delete()
        .eq('id', targetUserId);

      if (error) throw error;

      setActionMessage('User profile deleted successfully');
      fetchUsers();
      setTimeout(() => setActionMessage(null), 3000);
    } catch (err) {
      console.error('Failed to delete user profile:', err);
      alert(err.message || 'Failed to delete user profile');
    }
  };

  // Guard Access: Check if authenticated user is Admin
  if (!user || user.role !== 'admin') {
    return (
      <div className="min-h-screen bg-neutral-900 text-white flex items-center justify-center p-6 font-sans">
        <div className="max-w-[480px] w-full p-8 rounded-[28px] bg-neutral-800 border border-red-500/30 shadow-2xl text-center space-y-5">
          <div className="w-16 h-16 rounded-2xl bg-red-500/10 text-red-500 flex items-center justify-center mx-auto border border-red-500/20">
            <ShieldAlert className="w-8 h-8" />
          </div>
          <h2 className="font-outfit font-black text-2xl">Access Denied: Admin Required</h2>
          <p className="text-xs text-neutral-400 leading-relaxed">
            You are currently logged in as {user ? `"${user.email}" (${user.role})` : 'a guest user'}. The Admin Control Center is restricted strictly to accounts with <code className="text-red-400 font-mono">role === 'admin'</code>.
          </p>
          <div className="pt-2 flex gap-3">
            <button
              onClick={onNavigateHome}
              className="flex-1 py-3 rounded-xl bg-white/10 hover:bg-white/20 text-white font-bold text-xs cursor-pointer transition-colors"
            >
              Return Home
            </button>
            <button
              onClick={logout}
              className="flex-1 py-3 rounded-xl bg-red-600 hover:bg-red-700 text-white font-bold text-xs cursor-pointer transition-colors"
            >
              Sign Out & Switch Account
            </button>
          </div>
        </div>
      </div>
    );
  }

  const adminCount = usersList.filter(u => u.role === 'admin').length;
  const standardCount = usersList.filter(u => u.role === 'user').length;

  return (
    <div className="min-h-screen bg-neutral-900 text-neutral-100 font-sans">
      {/* Top Header */}
      <header className="sticky top-0 z-40 bg-neutral-900/90 backdrop-blur-md border-b border-neutral-800 px-6 py-4 flex items-center justify-between shadow-md">
        <div className="flex items-center gap-4">
          <button
            onClick={onNavigateHome}
            className="p-2 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-neutral-300 transition-colors cursor-pointer"
            title="Return to Main Page"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>

          <div className="font-fustat font-extrabold text-[20px] text-white flex items-center gap-2.5">
            <div className="p-1 rounded-lg bg-white/95 border border-white/20 shadow-2xs flex items-center shrink-0" title="CHARUSAT">
              <img src="/college-logo.png" alt="CHARUSAT Logo" className="h-6 w-auto object-contain" />
            </div>
            <div className="h-4 w-[1px] bg-white/20 shrink-0 hidden sm:block" />
            <div className="w-7 h-7 rounded-lg bg-[#0084FF] flex items-center justify-center text-white shrink-0">
              <ShieldCheck className="w-4 h-4" />
            </div>
            <span>Admin Control Center</span>
            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold bg-amber-500/10 text-amber-400 border border-amber-500/20 uppercase">
              Supabase Auth & DB
            </span>
          </div>
        </div>

        {/* Admin Session Badge */}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-3 px-3.5 py-1.5 rounded-xl bg-neutral-800 border border-neutral-700">
            <img
              src={user.avatar || 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=80&h=80&fit=crop&crop=face'}
              alt="Admin Avatar"
              className="w-7 h-7 rounded-full object-cover border border-amber-400"
            />
            <div className="hidden sm:flex flex-col text-left leading-tight">
              <span className="font-bold text-xs text-white">{user.name || 'System Admin'}</span>
              <span className="text-[10px] text-amber-400 font-mono">ROLE: ADMIN</span>
            </div>
          </div>

          <button
            onClick={logout}
            className="px-3.5 py-2 rounded-xl bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-400 font-bold text-xs flex items-center gap-1.5 cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Logout Admin</span>
          </button>
        </div>
      </header>

      {/* Main Container */}
      <main className="max-w-[1280px] mx-auto px-6 py-8 space-y-8">
        
        {/* System Overview Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          <div className="p-5 rounded-[22px] bg-neutral-800/80 border border-neutral-700 shadow-md">
            <div className="flex items-center justify-between text-neutral-400 text-xs font-mono mb-2">
              <span>TOTAL USERS</span>
              <Users className="w-4 h-4 text-[#0084FF]" />
            </div>
            <div className="font-outfit font-black text-3xl text-white">{usersList.length}</div>
            <div className="text-[11px] text-neutral-400 mt-1 font-sans">{standardCount} standard, {adminCount} admin</div>
          </div>

          <div className="p-5 rounded-[22px] bg-neutral-800/80 border border-neutral-700 shadow-md">
            <div className="flex items-center justify-between text-neutral-400 text-xs font-mono mb-2">
              <span>ADMINISTRATORS</span>
              <ShieldCheck className="w-4 h-4 text-amber-400" />
            </div>
            <div className="font-outfit font-black text-3xl text-amber-400">{adminCount}</div>
            <div className="text-[11px] text-neutral-400 mt-1 font-sans">Full administrative privileges</div>
          </div>

          <div className="p-5 rounded-[22px] bg-neutral-800/80 border border-neutral-700 shadow-md">
            <div className="flex items-center justify-between text-neutral-400 text-xs font-mono mb-2">
              <span>DATABASE ENGINE</span>
              <Database className="w-4 h-4 text-emerald-400" />
            </div>
            <div className="font-outfit font-bold text-xl text-white">Supabase DB</div>
            <div className="text-[11px] text-emerald-400 mt-1 font-mono">PostgreSQL Connected</div>
          </div>

          <div className="p-5 rounded-[22px] bg-neutral-800/80 border border-neutral-700 shadow-md">
            <div className="flex items-center justify-between text-neutral-400 text-xs font-mono mb-2">
              <span>SESSION SECURITY</span>
              <Lock className="w-4 h-4 text-purple-400" />
            </div>
            <div className="font-outfit font-bold text-xl text-white">Supabase Auth</div>
            <div className="text-[11px] text-purple-400 mt-1 font-mono">JWT & OAuth Security</div>
          </div>
        </div>

        {actionMessage && (
          <div className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-semibold flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Check className="w-4 h-4" />
              <span>{actionMessage}</span>
            </div>
          </div>
        )}

        {/* Meeting Scheduler & AI Briefing Dispatch Form */}
        <div className="p-6 rounded-[28px] bg-neutral-800/70 border border-neutral-700 shadow-xl space-y-5">
          <div className="flex items-center gap-3 pb-3 border-b border-neutral-700">
            <div className="w-9 h-9 rounded-xl bg-sky-500/10 text-[#0084FF] flex items-center justify-center border border-sky-500/20">
              <Calendar className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-outfit font-bold text-xl text-white">Schedule Meeting & Dispatch AI Briefing</h3>
              <p className="text-xs text-neutral-400">Schedules a meeting and automatically dispatches the Gemini AI briefing and emails 1 hour before start time.</p>
            </div>
          </div>

          <form onSubmit={handleCreateMeeting} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-neutral-300 block">Meeting Title</label>
                <input
                  type="text"
                  value={meetingTitle}
                  onChange={(e) => setMeetingTitle(e.target.value)}
                  placeholder="e.g. Q4 Strategy Sync & Product Architecture"
                  className="w-full p-3 rounded-xl bg-neutral-900 border border-neutral-700 text-xs text-white placeholder:text-neutral-500 focus:outline-none focus:border-[#0084FF]"
                  required
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-neutral-300 block">Attendee Email(s)</label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-neutral-500 absolute left-3 top-3.5" />
                  <input
                    type="text"
                    value={recipientEmail}
                    onChange={(e) => setRecipientEmail(e.target.value)}
                    placeholder="e.g. alex.user@revora.ai, sara@company.com"
                    className="w-full pl-9 p-3 rounded-xl bg-neutral-900 border border-neutral-700 text-xs text-white placeholder:text-neutral-500 focus:outline-none focus:border-[#0084FF]"
                    required
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-neutral-300 block">Meeting Date & Time</label>
                <div className="relative">
                  <Clock className="w-4 h-4 text-neutral-500 absolute left-3 top-3.5" />
                  <input
                    type="datetime-local"
                    value={scheduledAt}
                    onChange={(e) => setScheduledAt(e.target.value)}
                    className="w-full pl-9 p-3 rounded-xl bg-neutral-900 border border-neutral-700 text-xs text-white focus:outline-none focus:border-[#0084FF] [color-scheme:dark]"
                    required
                  />
                </div>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-neutral-300 block">Meeting Context / Details (Optional)</label>
              <textarea
                value={meetingDetails}
                onChange={(e) => setMeetingDetails(e.target.value)}
                placeholder="e.g. Discuss Q4 UI/UX revamps, sub-50ms streaming latency targets, and budget approvals."
                className="w-full h-24 p-3 rounded-xl bg-neutral-900 border border-neutral-700 text-xs text-white placeholder:text-neutral-500 focus:outline-none focus:border-[#0084FF] resize-none"
              />
            </div>

            <button
              type="submit"
              disabled={creatingMeeting}
              className="py-3 px-6 rounded-xl bg-[#0084FF] hover:bg-sky-600 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-lg transition-all cursor-pointer disabled:opacity-50"
            >
              {creatingMeeting ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Scheduling Meeting & AI Briefing...</span>
                </>
              ) : (
                <>
                  <Send className="w-4 h-4" />
                  <span>Schedule Meeting & Enable Auto-Dispatch</span>
                </>
              )}
            </button>
          </form>
        </div>

        {/* User Management Table */}
        <div className="p-6 rounded-[28px] bg-neutral-800/70 border border-neutral-700 shadow-xl space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-neutral-700">
            <div>
              <h3 className="font-outfit font-bold text-xl text-white flex items-center gap-2">
                User Directory & Role Manager
              </h3>
              <p className="text-xs text-neutral-400 mt-0.5">
                Manage registered user credentials, switch roles between 'user' and 'admin', or revoke access.
              </p>
            </div>

            <button
              onClick={fetchUsers}
              disabled={loadingUsers}
              className="px-3.5 py-2 rounded-xl bg-neutral-700 hover:bg-neutral-600 text-white font-bold text-xs flex items-center gap-2 transition-colors cursor-pointer w-fit"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loadingUsers ? 'animate-spin' : ''}`} />
              <span>Refresh Users</span>
            </button>
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-sans">
              <thead>
                <tr className="border-b border-neutral-700 text-neutral-400 font-mono text-[11px] uppercase tracking-wider">
                  <th className="pb-3 px-3">User Profile</th>
                  <th className="pb-3 px-3">Email Address</th>
                  <th className="pb-3 px-3">Current Role</th>
                  <th className="pb-3 px-3">Auth Provider</th>
                  <th className="pb-3 px-3">Joined Date</th>
                  <th className="pb-3 px-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-700/50">
                {usersList.map((u) => (
                  <tr key={u.id} className="hover:bg-neutral-700/30 transition-colors">
                    <td className="py-3.5 px-3">
                      <div className="flex items-center gap-3">
                        <img
                          src={u.avatar || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=80&h=80&fit=crop&crop=face'}
                          alt={u.name || 'User'}
                          className="w-8 h-8 rounded-full object-cover border border-neutral-600"
                        />
                        <span className="font-bold text-white text-sm">{u.name || 'User'}</span>
                      </div>
                    </td>

                    <td className="py-3.5 px-3 font-mono text-neutral-300">{u.email}</td>

                    <td className="py-3.5 px-3">
                      <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase font-mono border ${
                        u.role === 'admin'
                          ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                          : 'bg-sky-500/10 text-sky-400 border-sky-500/30'
                      }`}>
                        {u.role}
                      </span>
                    </td>

                    <td className="py-3.5 px-3 font-mono text-neutral-400">
                      {u.googleId ? 'Google OAuth2' : 'Passport Local'}
                    </td>

                    <td className="py-3.5 px-3 font-mono text-neutral-400">
                      {new Date(u.createdAt).toLocaleDateString()}
                    </td>

                    <td className="py-3.5 px-3 text-right space-x-2">
                      <button
                        onClick={() => handleToggleRole(u.id, u.role)}
                        className="px-2.5 py-1.5 rounded-lg bg-neutral-700 hover:bg-neutral-600 text-amber-300 font-bold text-[11px] cursor-pointer transition-colors"
                        title="Toggle role between user and admin"
                      >
                        {u.role === 'admin' ? 'Demote to User' : 'Promote to Admin'}
                      </button>

                      {u.id !== user.id && (
                        <button
                          onClick={() => handleDeleteUser(u.id)}
                          className="p-1.5 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 cursor-pointer transition-colors"
                          title="Delete user account"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

      </main>
    </div>
  );
}