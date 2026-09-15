import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../supabaseClient';
<<<<<<< HEAD
import AttendeePicker from '../components/AttendeePicker';
import MeetingCalendar from '../components/MeetingCalendar';
=======
>>>>>>> main
import MeetingBotDeployer from '../components/MeetingBotDeployer';
import AdminMeetingsPanel from '../components/AdminMeetingsPanel';
import { 
  ShieldCheck, LogOut, Users, Database, RefreshCw, Lock, Check, 
  Trash2, Calendar, Send, ShieldAlert, ArrowLeft, PlusCircle, X, 
  AlignLeft, Bot, Activity, Shield
} from 'lucide-react';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5001';

export default function AdminDashboard({ onNavigateHome }) {
  const { user, logout, loading } = useAuth();
  const navigate = useNavigate();
  const [usersList, setUsersList] = useState([]);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [actionMessage, setActionMessage] = useState(null);
  const [meetingsRefreshKey, setMeetingsRefreshKey] = useState(0);

  const handleSignOut = async () => {
    await logout();
    navigate('/', { replace: true });
  };

  const handleHomeClick = () => {
    if (onNavigateHome) onNavigateHome();
    navigate('/');
  };

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

  // A freshly deployed bot inserts a meetings row; nudge the monitor to refetch
  const handleBotDeployed = () => {
    setMeetingsRefreshKey((key) => key + 1);
  };

  // While auth status is loading, show clean light mode loading screen
  if (loading) {
    return (
      <div className="min-h-screen bg-[#F8FAFC] text-slate-900 flex flex-col items-center justify-center gap-4 font-sans">
        <div className="w-12 h-12 rounded-2xl bg-amber-50 text-amber-600 border border-amber-200/70 flex items-center justify-center shadow-xs animate-pulse">
          <ShieldCheck className="w-6 h-6" />
        </div>
        <div className="flex items-center gap-2 text-xs font-mono text-slate-500">
          <RefreshCw className="w-3.5 h-3.5 animate-spin text-[#0084FF]" />
          <span>Verifying Admin credentials...</span>
        </div>
      </div>
    );
  }

  // Guard Access: Check if authenticated user is Admin
  if (!user || user.role !== 'admin') {
    return (
      <div className="min-h-screen bg-[#F8FAFC] text-slate-900 flex items-center justify-center p-6 font-sans">
        <div className="max-w-[480px] w-full p-8 rounded-[28px] bg-white border border-red-200 shadow-xl text-center space-y-5">
          <div className="w-16 h-16 rounded-2xl bg-red-50 text-red-600 flex items-center justify-center mx-auto border border-red-200">
            <ShieldAlert className="w-8 h-8" />
          </div>
          <h2 className="font-outfit font-black text-2xl text-slate-900">Access Denied: Admin Required</h2>
          <p className="text-xs text-slate-600 leading-relaxed">
            You are currently logged in as {user ? `"${user.email}" (${user.role})` : 'a guest user'}. The Admin Control Center is restricted strictly to accounts with <code className="text-red-600 bg-red-50 px-1.5 py-0.5 rounded font-mono font-bold">role === 'admin'</code>.
          </p>
          <div className="pt-2 flex gap-3">
            <button
              onClick={handleHomeClick}
              className="flex-1 py-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs cursor-pointer transition-colors"
            >
              Return Home
            </button>
            <button
              onClick={handleSignOut}
              className="flex-1 py-3 rounded-xl bg-red-600 hover:bg-red-700 text-white font-bold text-xs cursor-pointer transition-colors shadow-xs"
            >
              Sign Out
            </button>
          </div>
        </div>
      </div>
    );
  }

  const adminCount = usersList.filter((u) => u.role === 'admin').length;
  const standardCount = usersList.filter((u) => u.role === 'user').length;

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-[#0F172A] font-sans antialiased">
      {/* Top Header */}
      <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-slate-200/80 px-6 py-3.5 flex items-center justify-between shadow-xs">
        <div className="flex items-center gap-4">
          <button
            onClick={handleHomeClick}
            className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200/80 text-slate-700 transition-colors cursor-pointer"
            title="Return to Main Page"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>

          <div className="font-fustat font-extrabold text-[20px] text-slate-900 flex items-center gap-2.5">
            <div className="p-1 rounded-lg bg-white border border-slate-200 shadow-2xs flex items-center shrink-0" title="CHARUSAT">
              <img src="/college-logo.png" alt="CHARUSAT Logo" className="h-6 w-auto object-contain" />
            </div>
            <div className="h-4 w-[1px] bg-slate-200 shrink-0 hidden sm:block" />
            <div className="w-7 h-7 rounded-lg bg-[#0084FF] flex items-center justify-center text-white shrink-0 shadow-xs">
              <Bot className="w-4 h-4" />
            </div>
            <span>Admin Control Center</span>
            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold bg-amber-50 text-amber-700 border border-amber-200/80 uppercase">
              Supabase Auth &amp; DB
            </span>
          </div>
        </div>

<<<<<<< HEAD
        {/* Schedule Button & Admin Session Badge */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => setIsCreateModalOpen(true)}
            className="px-3.5 py-2 rounded-xl bg-[#0084FF] hover:bg-[#0070D8] text-white font-bold text-xs flex items-center gap-1.5 transition-all shadow-xs hover:scale-105 cursor-pointer"
          >
            <PlusCircle className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Schedule Meeting</span>
          </button>

=======
        {/* Admin Session Badge */}
        <div className="flex items-center gap-4">
>>>>>>> main
          <div className="flex items-center gap-3 px-3.5 py-1.5 rounded-xl bg-slate-100/90 border border-slate-200/80">
            {user?.avatar ? (
              <img
                src={user.avatar}
                alt="Admin Avatar"
                className="w-7 h-7 rounded-full object-cover border border-amber-400"
              />
            ) : (
              <div className="w-7 h-7 rounded-full bg-amber-500 text-white flex items-center justify-center text-xs font-bold uppercase shadow-2xs shrink-0">
                {(user?.name || user?.email || 'A').charAt(0).toUpperCase()}
              </div>
            )}
            <div className="hidden sm:flex flex-col text-left leading-tight">
              <span className="font-bold text-xs text-slate-900">{user?.name || 'System Admin'}</span>
              <span className="text-[10px] text-amber-700 font-mono font-bold">ROLE: ADMIN</span>
            </div>
          </div>

          <button
            onClick={handleSignOut}
            className="px-3.5 py-2 rounded-xl bg-red-50 hover:bg-red-100 border border-red-200/70 text-red-600 font-bold text-xs flex items-center gap-1.5 transition-colors cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Logout Admin</span>
          </button>
        </div>
      </header>

      {/* Main Container */}
      <main className="max-w-[1280px] mx-auto px-6 py-8 space-y-8">
        
        {/* Page Heading / Intro */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="font-outfit font-black text-2xl sm:text-3xl text-slate-900 tracking-tight">
              Admin Dashboard
            </h1>
            <p className="text-sm text-slate-500 mt-1">
              Manage meetings, AI bot deployments, intelligence pipelines, and user directory.
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs font-mono font-semibold text-slate-600 bg-white border border-slate-200/80 px-3.5 py-2 rounded-xl shadow-2xs w-fit">
            <Activity className="w-3.5 h-3.5 text-emerald-500" />
            <span>All Systems Operational</span>
          </div>
        </div>

        {/* System Overview Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
<<<<<<< HEAD
=======
          
>>>>>>> main
          {/* Card 1: Total Users */}
          <div className="p-5 rounded-[22px] bg-white border border-slate-200/80 shadow-xs hover:shadow-sm transition-all flex flex-col justify-between">
            <div className="flex items-center justify-between text-slate-500 text-xs font-mono font-semibold mb-2">
              <span>TOTAL USERS</span>
              <div className="w-8 h-8 rounded-xl bg-sky-50 text-[#0084FF] flex items-center justify-center">
                <Users className="w-4 h-4" />
              </div>
            </div>
            <div>
              <div className="font-outfit font-black text-3xl text-slate-900">{usersList.length}</div>
              <div className="text-[12px] text-slate-500 mt-1 font-sans">{standardCount} standard, {adminCount} admin</div>
            </div>
          </div>

          {/* Card 2: Administrators */}
          <div className="p-5 rounded-[22px] bg-white border border-slate-200/80 shadow-xs hover:shadow-sm transition-all flex flex-col justify-between">
            <div className="flex items-center justify-between text-slate-500 text-xs font-mono font-semibold mb-2">
              <span>ADMINISTRATORS</span>
              <div className="w-8 h-8 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center">
                <ShieldCheck className="w-4 h-4" />
              </div>
            </div>
            <div>
              <div className="font-outfit font-black text-3xl text-amber-600">{adminCount}</div>
              <div className="text-[12px] text-slate-500 mt-1 font-sans">Full administrative privileges</div>
            </div>
          </div>

          {/* Card 3: Database Engine */}
          <div className="p-5 rounded-[22px] bg-white border border-slate-200/80 shadow-xs hover:shadow-sm transition-all flex flex-col justify-between">
            <div className="flex items-center justify-between text-slate-500 text-xs font-mono font-semibold mb-2">
              <span>DATABASE ENGINE</span>
              <div className="w-8 h-8 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
                <Database className="w-4 h-4" />
              </div>
            </div>
            <div>
              <div className="font-outfit font-bold text-xl text-slate-900">PostgreSQL</div>
              <div className="text-[12px] text-emerald-600 font-medium mt-1 flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block"></span>
                <span>Supabase Realtime Active</span>
              </div>
            </div>
          </div>

          {/* Card 4: Session Security */}
          <div className="p-5 rounded-[22px] bg-white border border-slate-200/80 shadow-xs hover:shadow-sm transition-all flex flex-col justify-between">
            <div className="flex items-center justify-between text-slate-500 text-xs font-mono font-semibold mb-2">
              <span>SESSION SECURITY</span>
              <div className="w-8 h-8 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center">
                <Lock className="w-4 h-4" />
              </div>
            </div>
            <div>
              <div className="font-outfit font-bold text-xl text-slate-900">Supabase Auth</div>
              <div className="text-[12px] text-purple-600 font-medium mt-1 flex items-center gap-1.5">
                <Shield className="w-3.5 h-3.5" />
                <span>JWT 256-bit &amp; RLS</span>
              </div>
            </div>
          </div>
        </div>

        {actionMessage && (
          <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-semibold flex items-center justify-between shadow-2xs">
            <div className="flex items-center gap-2">
              <Check className="w-4 h-4 text-emerald-600" />
              <span>{actionMessage}</span>
            </div>
          </div>
        )}

        {/* Meeting Scheduling & AI Bot Deployment (admin-only capability) */}
        <MeetingBotDeployer onBotDeployed={handleBotDeployed} assignableUsers={usersList} />

<<<<<<< HEAD
        {/* Interactive Meeting Calendar */}
        <MeetingCalendar
          meetings={meetingsList}
          briefings={briefingsList}
          onSelectMeeting={(m) => setSelectedMeeting(m)}
        />

=======
>>>>>>> main
        {/* Meeting & Bot Monitor: status, transcripts, recordings, summaries */}
        <AdminMeetingsPanel refreshKey={meetingsRefreshKey} users={usersList} />

        {/* User Management Table */}
        <div className="p-6 sm:p-8 rounded-[28px] bg-white border border-slate-200/80 shadow-xs space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-slate-100">
            <div>
              <h3 className="font-outfit font-bold text-xl text-slate-900 flex items-center gap-2">
                <Users className="w-5 h-5 text-[#0084FF]" />
                User Directory &amp; Role Manager
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Manage registered user credentials, switch roles between 'user' and 'admin', or revoke access.
              </p>
            </div>

            <button
              onClick={fetchUsers}
              disabled={loadingUsers}
              className="px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200/80 text-slate-700 font-bold text-xs flex items-center gap-2 transition-colors cursor-pointer w-fit"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loadingUsers ? 'animate-spin text-[#0084FF]' : ''}`} />
              <span>Refresh Users</span>
            </button>
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-sans">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500 font-mono text-[11px] uppercase tracking-wider bg-slate-50/50">
                  <th className="py-3 px-3.5 rounded-l-xl">User Profile</th>
                  <th className="py-3 px-3.5">Email Address</th>
                  <th className="py-3 px-3.5">Current Role</th>
                  <th className="py-3 px-3.5">Joined Date</th>
                  <th className="py-3 px-3.5 text-right rounded-r-xl">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {usersList.map((u) => (
                  <tr key={u.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="py-3.5 px-3.5">
                      <div className="flex items-center gap-3">
                        {u.avatar ? (
                          <img
                            src={u.avatar}
                            alt={u.name || 'User'}
                            className="w-8 h-8 rounded-full object-cover border border-slate-200 shadow-2xs"
                          />
                        ) : (
                          <div className="w-8 h-8 rounded-full bg-slate-100 text-slate-700 font-bold flex items-center justify-center text-xs shadow-2xs">
                            {(u.name || u.email || 'U').charAt(0).toUpperCase()}
                          </div>
                        )}
                        <span className="font-bold text-slate-900 text-sm">{u.name || 'User'}</span>
                      </div>
                    </td>

                    <td className="py-3.5 px-3.5 font-mono text-slate-600">{u.email}</td>

                    <td className="py-3.5 px-3.5">
                      <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase font-mono border ${
                        u.role === 'admin'
                          ? 'bg-amber-50 text-amber-700 border-amber-200/80'
                          : 'bg-sky-50 text-[#0084FF] border-sky-200/80'
                      }`}>
                        {u.role}
                      </span>
                    </td>

                    <td className="py-3.5 px-3.5 font-mono text-slate-500">
                      {u.createdAt ? new Date(u.createdAt).toLocaleDateString() : 'N/A'}
                    </td>

                    <td className="py-3.5 px-3.5 text-right space-x-2">
                      <button
                        onClick={() => handleToggleRole(u.id, u.role)}
                        className="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold text-[11px] cursor-pointer transition-colors border border-slate-200/60"
                        title="Toggle role between user and admin"
                      >
                        {u.role === 'admin' ? 'Demote to User' : 'Promote to Admin'}
                      </button>

                      {u.id !== user.id && (
                        <button
                          onClick={() => handleDeleteUser(u.id)}
                          className="p-1.5 rounded-lg bg-red-50 hover:bg-red-100 text-red-600 border border-red-200/60 cursor-pointer transition-colors inline-flex items-center justify-center align-middle"
                          title="Delete user account"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
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
