import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import {
  Trash2, Loader2, Mail, ShieldCheck, Mic, Users, Pencil, Search, User, KeyRound,
} from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from '@/components/ui/use-toast';

function roleBadge(role) {
  if (role === 'admin') return <Badge className="text-xs text-amber-300 border-amber-700 bg-amber-900/30">admin</Badge>;
  if (role === 'narrator') return <Badge className="text-xs text-purple-300 border-purple-700 bg-purple-900/30">Narr</Badge>;
  return <Badge className="text-xs text-slate-400 border-slate-600 bg-slate-800">user</Badge>;
}

/**
 * EditAppUser — where an admin promotes a front-end "user" to Narr or Admin,
 * and sets the Narr's backend password. That password is used only for the Narr
 * button; it never replaces the WordPress password that gets them into the
 * front end (admins don't use it — they sign in via Base44).
 */
function EditAppUserDialog({ appUser, onClose }) {
  const [role, setRole] = useState(appUser.role === 'admin' || appUser.role === 'narrator' ? appUser.role : 'user');
  const [password, setPassword] = useState(appUser.password || '');
  const [dateOfBirth, setDateOfBirth] = useState(appUser.date_of_birth ? String(appUser.date_of_birth).slice(0, 10) : '');
  const [saving, setSaving] = useState(false);
  const qc = useQueryClient();

  const handleSave = async () => {
    setSaving(true);
    try {
      const updates = { role };
      if (dateOfBirth) updates.date_of_birth = dateOfBirth;
      if (role === 'narrator') {
        if (!password.trim()) {
          toast({ variant: 'destructive', title: 'Narr password required', description: 'Set a backend password for this Narr.' });
          setSaving(false);
          return;
        }
        updates.password = password.trim();
      } else {
        // Moving away from Narr: clear the backend password so it can't be reused.
        updates.password = '';
      }

      await base44.entities.AppUser.update(appUser.id, updates);

      // Promoting to admin: invite them to Base44 so the Admin button works for them.
      if (role === 'admin' && appUser.role !== 'admin') {
        try { await base44.users.inviteUser(appUser.email, 'user'); } catch (e) { /* ignore — they may already be invited */ }
      }

      qc.invalidateQueries({ queryKey: ['appUsers-all'] });
      toast({ title: 'User updated', description: `${appUser.email} is now ${role === 'user' ? 'a regular user' : role === 'narrator' ? 'a Narr' : 'an admin'}.` });
      onClose();
    } catch (err) {
      toast({ variant: 'destructive', title: 'Update failed', description: err?.message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="bg-slate-800 border-slate-700 text-white">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Pencil className="w-4 h-4" /> Edit user</DialogTitle>
          <DialogDescription className="text-slate-400">{appUser.email}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <Label className="text-slate-300 mb-1.5 block">Role</Label>
            <Select value={role} onValueChange={setRole}>
              <SelectTrigger className="bg-slate-700 border-slate-600 text-white"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="user">user (front end only)</SelectItem>
                <SelectItem value="narrator">Narr (translate clones)</SelectItem>
                <SelectItem value="admin">Admin (full backend)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-slate-300 mb-1.5 block">Date of birth</Label>
            <input
              type="date"
              value={dateOfBirth}
              onChange={e => setDateOfBirth(e.target.value)}
              max={new Date().toISOString().split('T')[0]}
              className="flex h-9 w-full rounded-md border border-slate-600 bg-slate-700 px-3 py-1 text-sm text-white [color-scheme:dark]"
            />
          </div>
          {role === 'narrator' && (
            <div>
              <Label className="text-slate-300 mb-1.5 block">Narr backend password</Label>
              <Input value={password} onChange={e => setPassword(e.target.value)} className="bg-slate-700 border-slate-600 text-white" placeholder="Set the password for the Narr button" />
              <p className="text-xs text-slate-500 mt-1">Separate from the WordPress password they use for the front end.</p>
            </div>
          )}
          {role === 'admin' && (
            <p className="text-xs text-amber-300 bg-amber-900/20 border border-amber-700/40 rounded p-2">
              Admins log in via the Admin button with their Base44 sign-in. An invitation will be sent if this is a new admin.
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} className="text-slate-400">Cancel</Button>
          <Button onClick={handleSave} disabled={saving} className="bg-amber-500 hover:bg-amber-600 gap-2">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Pencil className="w-4 h-4" />} Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function UsersManager() {
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState(null);
  const qc = useQueryClient();

  const { data: appUsers = [], isLoading } = useQuery({
    queryKey: ['appUsers-all'],
    queryFn: () => base44.entities.AppUser.list('-created_date', 500),
  });

  const filtered = appUsers.filter(u => {
    if (!search.trim()) return true;
    const q = search.trim().toLowerCase();
    return (u.email || '').toLowerCase().includes(q) || `${u.first_name} ${u.last_name}`.toLowerCase().includes(q);
  });

  const sorted = [...filtered].sort((a, b) => {
    const order = (r) => (r === 'admin' ? 0 : r === 'narrator' ? 1 : 2);
    if (order(a.role) !== order(b.role)) return order(a.role) - order(b.role);
    return (a.email || '').localeCompare(b.email || '');
  });

  const handleDelete = async (userId) => {
    await base44.entities.AppUser.delete(userId);
    qc.invalidateQueries({ queryKey: ['appUsers-all'] });
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-white">Users Database</h2>
        <p className="text-slate-400 text-sm">Promote a user to Narr or Admin, and set a Narr's backend password here — it's separate from their WordPress front-end password.</p>
      </div>

      <div className="relative">
        <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
        <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by name or email" className="bg-slate-800 border-slate-700 text-white pl-9" />
      </div>

      {editing && <EditAppUserDialog appUser={editing} onClose={() => setEditing(null)} />}

      {isLoading ? (
        <div className="flex justify-center py-10"><Loader2 className="w-8 h-8 animate-spin text-amber-400" /></div>
      ) : sorted.length === 0 ? (
        <div className="text-center py-10 text-slate-500">
          <Users className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="font-medium">No users found</p>
        </div>
      ) : (
        <div className="space-y-2">
          {sorted.map(u => (
            <div key={u.id} className="bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 flex items-center gap-3">
              <div className={`p-2 rounded-lg shrink-0 ${u.role === 'admin' ? 'bg-amber-500' : u.role === 'narrator' ? 'bg-purple-500' : 'bg-slate-600'}`}>
                {u.role === 'admin' ? <ShieldCheck className="w-4 h-4 text-white" /> : u.role === 'narrator' ? <Mic className="w-4 h-4 text-white" /> : <User className="w-4 h-4 text-white" />}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-white truncate">{u.first_name} {u.last_name}</p>
                <p className="text-xs text-slate-400 flex items-center gap-1"><Mail className="w-3 h-3" /> {u.email}</p>
              </div>
              {u.role === 'narrator' && (
                <span className="hidden sm:flex items-center gap-1 text-xs text-purple-400" title="Backend password set"><KeyRound className="w-3.5 h-3.5" /></span>
              )}
              {roleBadge(u.role)}
              <Button variant="ghost" size="sm" onClick={() => setEditing(u)} className="text-slate-300 hover:text-white gap-2"><Pencil className="w-3.5 h-3.5" /> Edit</Button>
              <Button variant="ghost" size="icon" onClick={() => handleDelete(u.id)} className="text-slate-500 hover:text-red-400 w-7 h-7" title="Remove"><Trash2 className="w-3.5 h-3.5" /></Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}