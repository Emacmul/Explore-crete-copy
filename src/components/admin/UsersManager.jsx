import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import {
  Trash2, Loader2, Mail, ShieldCheck, Mic, Users, Pencil, Search, User, KeyRound, Gift, AlertTriangle,
} from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from '@/components/ui/use-toast';
import DateOfBirthSelect from '@/components/admin/DateOfBirthSelect';
import GiftWalkDialog from '@/components/admin/GiftWalkDialog';

function roleBadge(role) {
  if (role === 'super_admin') return <Badge className="text-xs text-red-300 border-red-700 bg-red-900/30">Super Admin</Badge>;
  if (role === 'admin') return <Badge className="text-xs text-amber-300 border-amber-700 bg-amber-900/30">admin</Badge>;
  if (role === 'narrator') return <Badge className="text-xs text-purple-300 border-purple-700 bg-purple-900/30">Narrator</Badge>;
  return <Badge className="text-xs text-slate-400 border-slate-600 bg-slate-800">user</Badge>;
}

/**
 * EditAppUser — where an admin promotes a front-end "user" to Narr or Admin,
 * and sets the Narr's backend password. That password is used only for the Narr
 * button; it never replaces the WordPress password that gets them into the
 * front end (admins don't use it — they sign in via Base44).
 *
 * Per Enda's report (front-end audit, 2026-09-05): this box used to start already
 * filled in with the user's CURRENT stored password — which, once passwords started
 * being kept scrambled (hashed), is not the real password at all, just its scrambled
 * form. Saving ANY change here (role, date of birth, anything) resent that scrambled
 * text as if it were a brand-new password, and the backend scrambles whatever it's
 * given — so it got scrambled a second time and saved, breaking the real password
 * with no warning at all. Fixed by leaving this box blank every time it opens:
 * blank now means "leave their password exactly as it is", and only typing a new
 * one here actually changes it. A password is still required the one time it
 * matters — promoting someone to Narrator/Admin who has never had one set.
 *
 * Per Enda's follow-up (2026-09-06): listAppUsersAdmin no longer sends the real stored
 * password (or any other user's private API keys) to the browser at all — see that
 * function's own comment. `appUser.has_password` is a plain yes/no in its place, which
 * is all this dialog ever actually needed to know.
 *
 * Per Enda's follow-up (2026-09-06): added a Super Admin tier above Admin, for the
 * handful of highest-risk actions (managing devices, forcing a logout, restoring a
 * disputed purchase, gifting a tour, deleting a user) — see appUserAuth.ts's
 * isSuperAdmin() for the full reasoning. Only a Super Admin can grant Admin or Super
 * Admin here, or change the role of someone who already has one of those two — a
 * regular Admin sees the Role box locked (with a note explaining why) when editing
 * someone already at Admin/Super Admin, and never sees those two options at all when
 * editing someone below that, so the choice on screen always matches what Save will
 * actually accept.
 */
function EditAppUserDialog({ appUser, onClose, isSuperAdmin }) {
  const wasElevated = appUser.role === 'admin' || appUser.role === 'super_admin';
  const roleLocked = wasElevated && !isSuperAdmin;
  const [role, setRole] = useState(['admin', 'narrator', 'super_admin'].includes(appUser.role) ? appUser.role : 'user');
  const [password, setPassword] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState(appUser.date_of_birth ? String(appUser.date_of_birth).slice(0, 10) : '');
  const [saving, setSaving] = useState(false);
  const qc = useQueryClient();
  const hasExistingPassword = !!appUser.has_password;
  const needsPassword = role === 'narrator' || role === 'admin' || role === 'super_admin';

  const handleSave = async () => {
    setSaving(true);
    try {
      const updates = { role };
      if (dateOfBirth) updates.date_of_birth = dateOfBirth;
      if (needsPassword) {
        if (password.trim()) {
          // Admin actually typed something — that's a deliberate new password.
          updates.password = password.trim();
        } else if (!hasExistingPassword) {
          // Blank AND no password on file yet at all — this is a first-time
          // promotion, so they'd have no way to ever log in. Block it, same as
          // before.
          toast({ variant: 'destructive', title: 'Password required', description: 'Set a backend password for this Narrator/Admin.' });
          setSaving(false);
          return;
        }
        // Else: blank, but a password already exists — leave `updates.password`
        // out entirely so saveAppUserAdmin never touches the stored one.
      } else {
        updates.password = '';
      }

      await base44.functions.invoke('saveAppUserAdmin', { id: appUser.id, updates });

      // Promoting to Admin or Super Admin: invite them to Base44 so the Admin button
      // works for them (only needed the first time — skip if they already had either).
      if ((role === 'admin' || role === 'super_admin') && !wasElevated) {
        try { await base44.users.inviteUser(appUser.email, 'user'); } catch (e) { /* ignore — they may already be invited */ }
      }

      qc.invalidateQueries({ queryKey: ['appUsers-all'] });
      const roleLabel = role === 'user' ? 'a regular user' : role === 'narrator' ? 'a Narrator' : role === 'super_admin' ? 'a Super Admin' : 'an Admin';
      toast({ title: 'User updated', description: `${appUser.email} is now ${roleLabel}.` });
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
            <Select value={role} onValueChange={setRole} disabled={roleLocked}>
              <SelectTrigger className="bg-slate-700 border-slate-600 text-white"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="user">user (front end only)</SelectItem>
                <SelectItem value="narrator">Narrator (translate clones)</SelectItem>
                {(isSuperAdmin || role === 'admin') && <SelectItem value="admin">Admin (backend, most actions)</SelectItem>}
                {(isSuperAdmin || role === 'super_admin') && <SelectItem value="super_admin">Super Admin (full authority)</SelectItem>}
              </SelectContent>
            </Select>
            {roleLocked && (
              <p className="text-xs text-slate-500 mt-1">Only a Super Admin can change this person's role.</p>
            )}
          </div>
          <div>
            <Label className="text-slate-300 mb-1.5 block">Date of birth</Label>
            <DateOfBirthSelect value={dateOfBirth} onChange={setDateOfBirth} />
          </div>
          {needsPassword && (
            <div>
              <Label className="text-slate-300 mb-1.5 block">
                Backend password {!hasExistingPassword && <span className="text-red-400">*</span>}
              </Label>
              <Input
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="bg-slate-700 border-slate-600 text-white"
                placeholder={hasExistingPassword ? 'Leave blank to keep their current password' : 'Set the backend password'}
              />
              {hasExistingPassword && (
                <p className="text-xs text-slate-500 mt-1">Only fill this in if you want to change their password.</p>
              )}
            </div>
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

export default function UsersManager({ isSuperAdmin = false }) {
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState(null);
  const [gifting, setGifting] = useState(null);
  // Per Enda (follow-up 160): deleting an account is one-way and now also force-logs-out
  // any device the person was signed into — a confirmation step matches how tour deletion
  // already works elsewhere in this admin panel, and is the natural place to show the
  // WordPress reminder below (deleteAppUserAdmin's own comment explains why this app can't
  // do that part for you).
  const [confirmDeleteUser, setConfirmDeleteUser] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const qc = useQueryClient();

  const { data: appUsers = [], isLoading } = useQuery({
    queryKey: ['appUsers-all'],
    queryFn: async () => {
      const res = await base44.functions.invoke('listAppUsersAdmin', {});
      return res.data?.users || [];
    },
  });

  const filtered = appUsers.filter(u => {
    if (!search.trim()) return true;
    const q = search.trim().toLowerCase();
    return (u.email || '').toLowerCase().includes(q) || `${u.first_name} ${u.last_name}`.toLowerCase().includes(q);
  });

  const sorted = [...filtered].sort((a, b) => {
    const order = (r) => (r === 'super_admin' ? 0 : r === 'admin' ? 1 : r === 'narrator' ? 2 : 3);
    if (order(a.role) !== order(b.role)) return order(a.role) - order(b.role);
    return (a.email || '').localeCompare(b.email || '');
  });

  // Per Enda (2026-09-06): deleting a user is now Super-Admin-only (see
  // deleteAppUserAdmin's own comment) — the Delete button is hidden for anyone else
  // (below), but wrapped in a try/catch here too in case it's ever reached another way.
  //
  // Per Enda (follow-up 160): the backend now also deactivates any device session this
  // person was logged into as part of deletion (see deleteAppUserAdmin) — the success
  // toast reports how many, and repeats the WordPress reminder from the confirmation
  // dialog so it's still visible at the exact moment the account is actually gone.
  const handleDelete = async () => {
    if (!confirmDeleteUser) return;
    setDeleting(true);
    try {
      const res = await base44.functions.invoke('deleteAppUserAdmin', { id: confirmDeleteUser.id });
      qc.invalidateQueries({ queryKey: ['appUsers-all'] });
      const n = res?.data?.sessionsDeactivated || 0;
      toast({
        title: 'Account deleted',
        description: `${confirmDeleteUser.email} removed${n > 0 ? ` — ${n} active device session${n === 1 ? '' : 's'} logged out` : ''}. Their WordPress login still works until you change or disable it on the WordPress site.`,
      });
      setConfirmDeleteUser(null);
    } catch (err) {
      toast({ variant: 'destructive', title: 'Delete failed', description: err?.message });
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-white">Users Database</h2>
        <p className="text-slate-400 text-sm">Promote a user to Narrator or Admin, and set a Narrator's backend password here — it's separate from their WordPress front-end password.</p>
      </div>

      <div className="relative">
        <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
        <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by name or email" className="bg-slate-800 border-slate-700 text-white pl-9" />
      </div>

      {editing && <EditAppUserDialog appUser={editing} onClose={() => setEditing(null)} isSuperAdmin={isSuperAdmin} />}
      {gifting && <GiftWalkDialog appUser={gifting} onClose={() => setGifting(null)} />}

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
              <div className={`p-2 rounded-lg shrink-0 ${u.role === 'super_admin' ? 'bg-red-600' : u.role === 'admin' ? 'bg-amber-500' : u.role === 'narrator' ? 'bg-purple-500' : 'bg-slate-600'}`}>
                {u.role === 'admin' || u.role === 'super_admin' ? <ShieldCheck className="w-4 h-4 text-white" /> : u.role === 'narrator' ? <Mic className="w-4 h-4 text-white" /> : <User className="w-4 h-4 text-white" />}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-white truncate">{u.first_name} {u.last_name}</p>
                <p className="text-xs text-slate-400 flex items-center gap-1"><Mail className="w-3 h-3" /> {u.email}</p>
              </div>
              {u.role === 'narrator' && (
                <span className="hidden sm:flex items-center gap-1 text-xs text-purple-400" title="Backend password set"><KeyRound className="w-3.5 h-3.5" /></span>
              )}
              {roleBadge(u.role)}
              {/* Per Enda (2026-09-06): gifting a tour and deleting a user are both now
                  Super-Admin-only actions (see grantWalk's and deleteAppUserAdmin's own
                  comments) — hidden here for anyone else, rather than showing a button
                  that would just fail. */}
              {isSuperAdmin && (
                <Button variant="ghost" size="sm" onClick={() => setGifting(u)} className="text-slate-300 hover:text-amber-400 gap-2"><Gift className="w-3.5 h-3.5" /> Gift</Button>
              )}
              <Button variant="ghost" size="sm" onClick={() => setEditing(u)} className="text-slate-300 hover:text-white gap-2"><Pencil className="w-3.5 h-3.5" /> Edit</Button>
              {isSuperAdmin && (
                <Button variant="ghost" size="icon" onClick={() => setConfirmDeleteUser(u)} className="text-slate-500 hover:text-red-400 w-7 h-7" title="Remove"><Trash2 className="w-3.5 h-3.5" /></Button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Per Enda (follow-up 160): deleting an account is one-way, so it gets the same
          confirm-before-you-commit treatment as tour deletion elsewhere in this admin
          panel. The WordPress line here is not boilerplate — it's the one real gap the
          backend genuinely cannot close on its own (see deleteAppUserAdmin's own
          comment), so it needs to actually be read, not just clicked past. */}
      <AlertDialog open={!!confirmDeleteUser} onOpenChange={open => { if (!open) setConfirmDeleteUser(null); }}>
        <AlertDialogContent className="bg-slate-800 border-2 border-red-600 text-white">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-red-400 text-xl">
              <AlertTriangle className="w-6 h-6 shrink-0" />
              Delete this account?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="text-slate-300 space-y-3 pt-1">
                <p>
                  This action is <strong className="text-red-400">irreversible</strong> — the account record for{' '}
                  <strong className="text-white">{confirmDeleteUser?.email}</strong> will be permanently deleted,
                  and any device they're currently logged into will be signed out immediately.
                </p>
                <p className="text-amber-400 font-semibold">
                  This does NOT touch their WordPress login. Their WordPress password will keep working until you
                  separately change or disable it on the WordPress site — this app has no way to do that for you.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="bg-slate-700 border-slate-600 text-white hover:bg-slate-600 hover:text-white">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); handleDelete(); }}
              disabled={deleting}
              className="bg-red-600 hover:bg-red-700 text-white disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-red-600"
            >
              {deleting ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
              Yes, delete account
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}