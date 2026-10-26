import React, { useState, useEffect } from 'react';
import { supabase } from '../supabaseClient';
import { Users, Search, Check, X, UserPlus } from 'lucide-react';

export default function AttendeePicker({ selectedEmails = [], onChange }) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [employees, setEmployees] = useState([]);

  // Fetch real users from Supabase profiles table
  useEffect(() => {
    async function loadDirectory() {
      try {
        const { data, error } = await supabase.from('profiles').select('id, full_name, email, role, avatar_url');
        if (!error && data && data.length > 0) {
          const formatted = data.map(d => {
            const isDesignatedAdmin = (d.email || '').trim().toLowerCase() === 'evv18407@gmail.com';
            return {
              id: d.id,
              name: d.full_name || d.name || d.email.split('@')[0],
              email: d.email,
              role: isDesignatedAdmin ? 'Admin' : 'Member',
              avatar: d.avatar_url || `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(d.full_name || d.email)}`
            };
          });
          setEmployees(formatted);
        }
      } catch (_) {}
    }
    loadDirectory();
  }, []);

  // Parse current comma-separated email string into clean array
  const currentSelected = selectedEmails
    ? (Array.isArray(selectedEmails) ? selectedEmails : selectedEmails.split(',').map(s => s.trim()).filter(Boolean))
    : [];

  const toggleAttendee = (email) => {
    let updated;
    if (currentSelected.includes(email)) {
      updated = currentSelected.filter(e => e !== email);
    } else {
      updated = [...currentSelected, email];
    }
    onChange(updated.join(', '));
  };

  const filteredEmployees = employees.filter(emp =>
    (emp.name || '').toLowerCase().includes(search.toLowerCase()) ||
    (emp.email || '').toLowerCase().includes(search.toLowerCase()) ||
    (emp.role || '').toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-xs font-bold text-black flex items-center gap-1.5">
          <Users className="w-3.5 h-3.5 text-[#0084FF]" />
          <span>Meeting Attendees</span>
        </label>
        
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className="px-2.5 py-1 rounded-lg bg-sky-50 hover:bg-sky-100 text-[#0084FF] text-[11px] font-bold flex items-center gap-1 transition-colors cursor-pointer"
        >
          <UserPlus className="w-3 h-3" />
          <span>{isOpen ? 'Close Directory' : 'Select from Directory'}</span>
        </button>
      </div>

      {/* Selected Chips View */}
      {currentSelected.length > 0 && (
        <div className="flex flex-wrap gap-1.5 p-2 rounded-xl bg-neutral-50 border border-black/5">
          {currentSelected.map((email) => {
            const matchedEmp = employees.find(e => e.email.toLowerCase() === email.toLowerCase());
            return (
              <span
                key={email}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white border border-black/10 text-[11px] font-medium text-black shadow-2xs"
              >
                <span className="font-bold text-[#0084FF]">{matchedEmp?.name || email}</span>
                <span className="text-black/40 text-[10px]">&lt;{email}&gt;</span>
                <button
                  type="button"
                  onClick={() => toggleAttendee(email)}
                  className="hover:text-red-500 text-black/40 cursor-pointer ml-0.5"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            );
          })}
        </div>
      )}

      {/* Slide-down Directory Selection Box */}
      {isOpen ? (
        <div className="p-3 rounded-2xl bg-white border border-black/10 shadow-lg space-y-3 animate-in fade-in duration-150">
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-black/40" />
            <input
              type="text"
              placeholder="Search team members by name, role or email..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 rounded-xl bg-neutral-50 border border-black/10 text-xs focus:outline-none focus:border-[#0084FF]"
            />
          </div>

          <div className="flex items-center justify-between px-1 text-[11px]">
            <button
              type="button"
              onClick={() => {
                const allEmails = employees.map(e => e.email).filter(Boolean);
                onChange(allEmails.join(', '));
              }}
              className="font-bold text-[#0084FF] hover:underline cursor-pointer"
            >
              + Select All ({employees.length}) Members
            </button>
            {currentSelected.length > 0 && (
              <button
                type="button"
                onClick={() => onChange('')}
                className="font-semibold text-slate-400 hover:text-red-500 cursor-pointer"
              >
                Clear Selection
              </button>
            )}
          </div>

          <div className="max-h-[180px] overflow-y-auto space-y-1 pr-1">
            {filteredEmployees.map((emp) => {
              const isSelected = currentSelected.includes(emp.email);
              return (
                <div
                  key={emp.id || emp.email}
                  onClick={() => toggleAttendee(emp.email)}
                  className={`flex items-center justify-between p-2 rounded-xl transition-all cursor-pointer ${
                    isSelected
                      ? 'bg-sky-50 border border-sky-200'
                      : 'hover:bg-neutral-50 border border-transparent'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <img
                      src={emp.avatar}
                      alt={emp.name}
                      className="w-6 h-6 rounded-full object-cover border border-black/5"
                    />
                    <div className="text-left">
                      <div className="text-xs font-bold text-black leading-tight flex items-center gap-1.5">
                        <span>{emp.name}</span>
                        {emp.role === 'Admin' ? (
                          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-md bg-amber-50 text-amber-700 border border-amber-200">
                            Admin
                          </span>
                        ) : (
                          <span className="text-[9px] font-normal px-1.5 py-0.5 rounded-md bg-slate-100 text-slate-500">
                            Member
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-black/50">{emp.email}</div>
                    </div>
                  </div>

                  <div className={`w-5 h-5 rounded-lg flex items-center justify-center border transition-all ${
                    isSelected
                      ? 'bg-[#0084FF] border-[#0084FF] text-white'
                      : 'border-black/20 bg-white'
                  }`}>
                    {isSelected && <Check className="w-3 h-3 stroke-[3]" />}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        /* Manual fallback text input */
        <input
          type="text"
          placeholder="e.g. rudrikakadiya26@gmail.com, 25cs027@charusat.edu.in"
          value={typeof selectedEmails === 'string' ? selectedEmails : currentSelected.join(', ')}
          onChange={(e) => onChange(e.target.value)}
          className="w-full px-3.5 py-2.5 rounded-xl border border-black/10 bg-neutral-50 focus:bg-white focus:border-[#0084FF] focus:outline-none text-xs text-black"
        />
      )}
    </div>
  );
}