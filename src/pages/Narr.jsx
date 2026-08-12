import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, Mic, ArrowLeft, LogOut, Eye, EyeOff } from 'lucide-react';
import { createPageUrl } from '@/utils';
import { Link, useNavigate } from 'react-router-dom';
import BackendShell from '@/components/admin/BackendShell';

const SESSION_KEY = 'narr_session';

/**
 * Narr Studio entry. A Narr first signs into the front end with their WordPress
 * password (so we know whose Narr password to check), then opens this page via
 * the "Narr" button and enters the separate backend password an admin set for
 * them. On success the shared BackendShell renders in narrator mode.
 */
export default function Narr() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [session, setSession] = useState(() => {
    try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null'); } catch { return null; }
  });
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (!user) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center text-white px-4">
        <div className="text-center space-y-4">
          <p className="text-slate-400">Please log in to the front end first.</p>
          <Link to={createPageUrl('Home')}><Button>Go to front end</Button></Link>
        </div>
      </div>
    );
  }

  const handleLogin = async () => {
    setError('');
    if (!password) { setError('Enter your Narr password.'); return; }
    setBusy(true);
    try {
      const res = await base44.functions.invoke('narrLogin', { email: user.email, password });
      if (res?.data?.ok) {
        const sess = { email: user.email, full_name: res.data.name || user.full_name, role: 'narrator', isAdmin: !!res.data.isAdmin, token: res.data.token };
        sessionStorage.setItem(SESSION_KEY, JSON.stringify(sess));
        setSession(sess);
      } else {
        setError(res?.data?.error || 'Wrong email or password.');
      }
    } catch (err) {
      setError(err?.message || 'Login failed.');
    } finally { setBusy(false); }
  };

  const handleLogout = () => {
    sessionStorage.removeItem(SESSION_KEY);
    setSession(null);
    setPassword('');
    navigate(createPageUrl('Home'));
  };

  if (session) {
    return <BackendShell user={session} userRole="narrator" authMode="narr" unrestricted={!!session.isAdmin} onLogout={handleLogout} />;
  }

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center px-4">
      <div className="w-full max-w-sm bg-slate-900 border border-slate-700 rounded-2xl p-6 space-y-5">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-purple-500"><Mic className="w-5 h-5 text-white" /></div>
          <div>
            <h1 className="font-bold text-white">Narr Studio</h1>
            <p className="text-xs text-slate-400">{user.email}</p>
          </div>
        </div>
        <div>
          <Label className="text-slate-300 mb-1.5 block">Narr password</Label>
          <div className="relative">
            <Input
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={e => setPassword(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleLogin()}
              className="bg-slate-700 border-slate-600 text-white pr-10"
              placeholder="Enter your Narr password"
              autoFocus
            />
            <button
              type="button"
              onClick={() => setShowPassword(v => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200"
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              tabIndex={-1}
            >
              {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          {error && <p className="text-red-400 text-sm mt-2">{error}</p>}
          <p className="text-xs text-slate-500 mt-2">This is the backend password an admin set for you — separate from your WordPress front-end password.</p>
        </div>
        <div className="flex items-center justify-between">
          <Link to={createPageUrl('Home')}>
            <Button variant="ghost" size="sm" className="text-slate-400 gap-2"><ArrowLeft className="w-4 h-4" /> Front End</Button>
          </Link>
          <Button onClick={handleLogin} disabled={busy} className="bg-purple-600 hover:bg-purple-700 gap-2">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogOut className="w-4 h-4" />} Enter
          </Button>
        </div>
      </div>
    </div>
  );
}