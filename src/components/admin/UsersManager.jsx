import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  UserPlus, Trash2, Loader2, Mail, ShieldCheck, Mic,
  Users, Download, CheckCircle2,
} from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { useQuery, useQueryClient } from '@tanstack/react-query';

export default function UsersManager() {
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ email: '', first_name: '', last_name: '', role: 'narrator' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [inviteStatus, setInviteStatus] = useState(null);
  const queryClient = useQueryClient();

  const { data: appUsers = [], isLoading } = useQuery({
    queryKey: ['appUsers-admin'],
    queryFn: () => base44.entities.AppUser.filter({ role: { $in: ['admin', 'narrator'] } }, '-created_date', 200),
  });

  const handleCreate = async () => {
    setError('');
    if (!form.email.trim() || !form.first_name.trim() || !form.last_name.trim()) {
      setError('All fields are required.');
      return;
    }

    setSaving(true);
    try {
      await base44.entities.AppUser.create({
        email: form.email.trim().toLowerCase(),
        first_name: form.first_name.trim(),
        last_name: form.last_name.trim(),
        role: form.role,
        registration_complete: false,
      });

      try {
        await base44.users.inviteUser(form.email.trim(), 'user');
        setInviteStatus({ email: form.email, sent: true });
      } catch (inviteErr) {
        setInviteStatus({ email: form.email, sent: false, error: inviteErr.message });
      }

      queryClient.invalidateQueries({ queryKey: ['appUsers-admin'] });
      setForm({ email: '', first_name: '', last_name: '', role: 'narrator' });
      setShowForm(false);
    } catch (err) {
      setError(err.message || 'Failed to create user.');
    }
    setSaving(false);
  };

  const handleDelete = async (userId) => {
    await base44.entities.AppUser.delete(userId);
    queryClient.invalidateQueries({ queryKey: ['appUsers-admin'] });
  };

  const handleExportCSV = async () => {
    const headers = ['First Name', 'Last Name', 'Email', 'Role', 'Created'];
    const rows = appUsers.map(u => [
      u.first_name, u.last_name, u.email, u.role || '—',
      u.created_date ? new Date(u.created_date).toLocaleDateString() : '',
    ]);
    const csv = [headers, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `narrator-users-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const admins = appUsers.filter(u => u.role === 'admin');
  const narrators = appUsers.filter(u => u.role === 'narrator');

  const renderUser = (u) => (
    <div key={u.id} className="bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 flex items-center gap-3">
      <div className={`p-2 rounded-lg ${u.role === 'admin' ? 'bg-amber-500' : 'bg-purple-500'}`}>
        {u.role === 'admin' ? <ShieldCheck className="w-4 h-4 text-white" /> : <Mic className="w-4 h-4 text-white" />}
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-medium text-white truncate">{u.first_name} {u.last_name}</p>
        <p className="text-xs text-slate-400 flex items-center gap-1">
          <Mail className="w-3 h-3" /> {u.email}
        </p>
      </div>
      <Badge variant="outline" className={`text-xs ${u.role === 'admin' ? 'text-amber-300 border-amber-700 bg-amber-900/30' : 'text-purple-300 border-purple-700 bg-purple-900/30'}`}>
        {u.role}
      </Badge>
      <Button
        variant="ghost"
        size="icon"
        onClick={() => handleDelete(u.id)}
        className="text-slate-500 hover:text-red-400 w-7 h-7"
        title="Remove"
      >
        <Trash2 className="w-3.5 h-3.5" />
      </Button>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white">Users Database</h2>
          <p className="text-slate-400 text-sm">Manage who can access the admin panel</p>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={handleExportCSV} className="text-green-300 hover:text-white gap-2 border border-green-700/50 hover:bg-green-800/30">
            <Download className="w-4 h-4" /> Export CSV
          </Button>
          <Button onClick={() => setShowForm(f => !f)} className="bg-amber-500 hover:bg-amber-600 text-white gap-2">
            <UserPlus className="w-4 h-4" /> Add Narrator
          </Button>
        </div>
      </div>

      {inviteStatus && (
        <div className={`rounded-lg p-3 border text-sm ${inviteStatus.sent ? 'bg-green-900/30 border-green-700/50 text-green-300' : 'bg-amber-900/30 border-amber-700/50 text-amber-300'}`}>
          {inviteStatus.sent ? (
            <span className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4" /> Invitation email sent to {inviteStatus.email}. The narrator can log in once they set their password.</span>
          ) : (
            <span>User record created, but invitation email failed: {inviteStatus.error}. You may need to invite them manually.</span>
          )}
        </div>
      )}

      {showForm && (
        <div className="bg-slate-800 border border-slate-700 rounded-xl p-4 space-y-4">
          <h3 className="font-semibold text-white">New Narrator</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label className="text-slate-300 mb-1.5 block">First Name *</Label>
              <Input value={form.first_name} onChange={e => setForm(f => ({ ...f, first_name: e.target.value }))} className="bg-slate-700 border-slate-600 text-white" placeholder="Maria" />
            </div>
            <div>
              <Label className="text-slate-300 mb-1.5 block">Last Name *</Label>
              <Input value={form.last_name} onChange={e => setForm(f => ({ ...f, last_name: e.target.value }))} className="bg-slate-700 border-slate-600 text-white" placeholder="Papadaki" />
            </div>
          </div>
          <div>
            <Label className="text-slate-300 mb-1.5 block">Email *</Label>
            <Input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} className="bg-slate-700 border-slate-600 text-white" placeholder="maria@example.com" />
            <p className="text-xs text-slate-500 mt-1">An invitation email will be sent so they can set a password and log in.</p>
          </div>
          {error && <p className="text-red-400 text-sm">{error}</p>}
          <div className="flex gap-2">
            <Button onClick={handleCreate} disabled={saving} className="bg-amber-500 hover:bg-amber-600 gap-2">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
              Create & Invite
            </Button>
            <Button variant="ghost" onClick={() => { setShowForm(false); setError(''); }} className="text-slate-400">Cancel</Button>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="flex justify-center py-10"><Loader2 className="w-8 h-8 animate-spin text-amber-400" /></div>
      ) : (
        <div className="space-y-6">
          {narrators.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-2">
                <Mic className="w-4 h-4" /> Narrators ({narrators.length})
              </h3>
              <div className="space-y-2">{narrators.map(renderUser)}</div>
            </div>
          )}
          {admins.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-2">
                <ShieldCheck className="w-4 h-4" /> Admins ({admins.length})
              </h3>
              <div className="space-y-2">{admins.map(renderUser)}</div>
            </div>
          )}
          {appUsers.length === 0 && (
            <div className="text-center py-10 text-slate-500">
              <Users className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p className="font-medium">No narrator or admin users yet</p>
              <p className="text-sm">Click "Add Narrator" to create the first one</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}