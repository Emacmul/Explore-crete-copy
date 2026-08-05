import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Loader2, Smartphone, Trash2, LogOut, RefreshCw, AlertCircle, ShieldCheck } from 'lucide-react';

export default function DeviceManager() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await base44.functions.invoke('listDevicesAdmin');
      const data = res?.data !== undefined ? res.data : res;
      setUsers(data.users || []);
    } catch (e) {
      setError(e?.response?.data?.error || e.message || 'Failed to load devices');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const removeDevice = async (userEmail, deviceId) => {
    if (!window.confirm('Remove this device? The user will need to verify it again on next sign-in from that device.')) return;
    setBusy({ type: 'remove', deviceId });
    try {
      await base44.functions.invoke('removeDeviceAdmin', { user_email: userEmail, device_id: deviceId });
      await load();
    } catch (e) {
      setError(e?.response?.data?.error || e.message || 'Failed to remove device');
    } finally {
      setBusy(null);
    }
  };

  const forceLogout = async (userEmail) => {
    if (!window.confirm('Force log out this account? Their active session will end immediately.')) return;
    setBusy({ type: 'logout', userEmail });
    try {
      await base44.functions.invoke('forceLogoutAdmin', { user_email: userEmail });
      await load();
    } catch (e) {
      setError(e?.response?.data?.error || e.message || 'Failed to log out user');
    } finally {
      setBusy(null);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-amber-400" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <Smartphone className="w-5 h-5 text-emerald-400" /> Device Logins
          </h2>
          <p className="text-sm text-slate-400">Registered devices & active sessions per account.</p>
        </div>
        <Button variant="outline" size="sm" onClick={load} className="bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700 gap-2">
          <RefreshCw className="w-4 h-4" /> Refresh
        </Button>
      </div>

      {error && (
        <div className="flex items-start gap-2 text-sm text-red-300 bg-red-950/50 border border-red-800 rounded-lg p-3">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {users.length === 0 ? (
        <div className="text-center py-12 text-slate-500 border border-dashed border-slate-700 rounded-xl">
          <Smartphone className="w-10 h-10 mx-auto mb-2 opacity-30" />
          <p className="font-medium">No devices registered yet</p>
          <p className="text-sm">Devices appear here after the first app sign-in on a new device.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {users.map((u) => (
            <div key={u.email} className="bg-slate-800 border border-slate-700 rounded-xl p-4">
              <div className="flex items-center justify-between gap-3 mb-3">
                <div>
                  <p className="font-medium text-white">{u.email}</p>
                  <p className="text-xs text-slate-400">{u.devices.length} device{u.devices.length !== 1 ? 's' : ''} registered</p>
                </div>
                <div className="flex items-center gap-2">
                  {u.active_session?.live ? (
                    <span className="text-xs flex items-center gap-1 text-emerald-400">
                      <ShieldCheck className="w-3.5 h-3.5" /> Session active
                    </span>
                  ) : null}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => forceLogout(u.email)}
                    disabled={busy?.type === 'logout' && busy?.userEmail === u.email}
                    className="bg-slate-900 border-slate-700 text-slate-200 hover:bg-slate-700 gap-2"
                  >
                    {busy?.type === 'logout' && busy?.userEmail === u.email
                      ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      : <LogOut className="w-3.5 h-3.5" />}
                    Force Logout
                  </Button>
                </div>
              </div>
              <div className="space-y-2">
                {u.devices.map((d) => (
                  <div key={d.id} className="flex items-center justify-between gap-3 bg-slate-900/50 rounded-lg px-3 py-2">
                    <div className="min-w-0">
                      <p className="text-sm text-slate-200 truncate">{d.label || 'Unknown device'}</p>
                      <p className="text-xs text-slate-500 font-mono truncate">{d.device_id}</p>
                      <p className="text-xs text-slate-500">
                        First seen {d.first_seen ? new Date(d.first_seen).toLocaleString() : '—'}
                        {' · '}Last used {d.last_used ? new Date(d.last_used).toLocaleString() : '—'}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => removeDevice(u.email, d.device_id)}
                      disabled={busy?.type === 'remove' && busy?.deviceId === d.device_id}
                      className="text-red-400 hover:text-red-300 hover:bg-red-950/40 gap-2"
                    >
                      {busy?.type === 'remove' && busy?.deviceId === d.device_id
                        ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        : <Trash2 className="w-3.5 h-3.5" />}
                      Remove
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}