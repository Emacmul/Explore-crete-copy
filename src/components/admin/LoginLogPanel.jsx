import React from 'react';
import { Loader2, LogIn, History } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';

const roleBadge = (role) => {
  if (role === 'super_admin') return <Badge className="text-xs text-red-300 border-red-700 bg-red-900/30">Super Admin</Badge>;
  if (role === 'admin') return <Badge className="text-xs text-amber-300 border-amber-700 bg-amber-900/30">admin</Badge>;
  if (role === 'narrator') return <Badge className="text-xs text-purple-300 border-purple-700 bg-purple-900/30">Narrator</Badge>;
  return <Badge className="text-xs text-slate-400 border-slate-600 bg-slate-800">{role}</Badge>;
};

const TYPE_LABELS = { front_end: 'Front End', narr_studio: 'Narr Studio' };

/**
 * Login Log — every successful Narrator/Admin sign-in of the last 7 days, newest first.
 *
 * Records are written by the backend at the moment of login (narrLogin for the
 * backend password sign-in, loginWithDeviceCheck's staff branch for the WordPress
 * front-end sign-in), so the times here are server times — immune to a device's
 * clock or a cleared browser. created_date on each row is the login time.
 *
 * The earliest rows (marked "backfilled") were reconstructed from the existing
 * device/session records when this log was introduced — the system only started
 * recording logins from then on, so anything before that date cannot be shown.
 */
export default function LoginLogPanel() {
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data: logins = [], isLoading } = useQuery({
    queryKey: ['login-log'],
    queryFn: async () => {
      const page = await base44.entities.LoginLog.filter(
        { created_date: { $gte: weekAgo } },
        { sort: '-created_date', limit: 500 }
      );
      return page.items || [];
    },
  });

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold text-white flex items-center gap-2">
          <LogIn className="w-5 h-5 text-emerald-400" /> Login Log
        </h2>
        <p className="text-xs text-slate-400 mt-1">
          Every Narrator/Admin sign-in of the last 7 days — both the WordPress front-end login and the
          backend Narr Studio / Admin Panel password login. Times shown in your device's time zone.
        </p>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-slate-500" /></div>
      ) : logins.length === 0 ? (
        <div className="text-center py-16 text-slate-400 border border-slate-800 rounded-lg">
          <History className="w-8 h-8 mx-auto mb-2 text-slate-600" />
          <p>No Narrator/Admin logins recorded in the last 7 days.</p>
          <p className="text-xs text-slate-500 mt-1">Note: logins before this log was added (15 Oct 2026) could not be recorded.</p>
        </div>
      ) : (
        <div className="border border-slate-800 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-900 text-slate-400 text-xs uppercase">
              <tr>
                <th className="text-left px-4 py-2">When</th>
                <th className="text-left px-4 py-2">Who</th>
                <th className="text-left px-4 py-2">Role</th>
                <th className="text-left px-4 py-2">Signed in via</th>
                <th className="text-left px-4 py-2">Device</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {logins.map((l) => (
                <tr key={l.id} className="text-slate-200">
                  <td className="px-4 py-2 whitespace-nowrap">
                    {new Date(l.login_at || l.created_date).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
                    {l.description && String(l.description).includes('Backfilled') && (
                      <Badge variant="outline" className="ml-2 text-[10px] text-slate-400 border-slate-600 bg-slate-800">backfilled</Badge>
                    )}
                  </td>
                  <td className="px-4 py-2">{l.user_email}</td>
                  <td className="px-4 py-2">{roleBadge(l.role)}</td>
                  <td className="px-4 py-2">{TYPE_LABELS[l.login_type] || l.login_type}</td>
                  <td className="px-4 py-2 text-slate-400 text-xs">
                    {l.device_label || (l.device_id ? String(l.device_id).slice(0, 8) + '…' : '—')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}