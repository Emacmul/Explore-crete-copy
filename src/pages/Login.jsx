import React, { useState } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Mountain, Loader2, AlertCircle, ArrowLeft, Mail } from 'lucide-react';

export default function Login() {
  const { login, verifyCode } = useAuth();
  const [step, setStep] = useState('credentials'); // 'credentials' | 'code'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const result = await login(email, password);
      if (result?.challengeRequired) {
        setStep('code');
        setCode('');
      }
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Login failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async (e) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await verifyCode(email, password, code);
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Verification failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const backToCredentials = () => {
    setStep('credentials');
    setError(null);
    setCode('');
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-b from-teal-700 to-teal-900 p-6">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-white/10 backdrop-blur-sm mb-4">
            <Mountain className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-white">Explore Crete</h1>
          <p className="text-teal-200 text-sm mt-1">Walking tours &amp; driving audio guides</p>
        </div>

        <div className="bg-white rounded-2xl shadow-xl p-6 space-y-4">
          {step === 'credentials' && (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  required
                  autoComplete="email"
                  disabled={loading}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Your password"
                  required
                  autoComplete="current-password"
                  disabled={loading}
                />
              </div>

              {error && (
                <div className="flex items-start gap-2 text-sm text-red-600 bg-red-50 rounded-lg p-3">
                  <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                  <span dangerouslySetInnerHTML={{ __html: error }} />
                </div>
              )}

              <Button
                type="submit"
                className="w-full bg-teal-700 hover:bg-teal-800"
                disabled={loading || !email || !password}
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" /> Signing in...
                  </>
                ) : (
                  'Sign In'
                )}
              </Button>
            </form>
          )}

          {step === 'code' && (
            <form onSubmit={handleVerify} className="space-y-4">
              <div className="text-center space-y-1">
                <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-teal-50 mb-1">
                  <Mail className="w-6 h-6 text-teal-700" />
                </div>
                <p className="text-sm text-slate-700">We emailed a 6-digit code to</p>
                <p className="font-medium text-slate-900">{email}</p>
                <p className="text-xs text-slate-500">Enter it below to confirm this device. The code expires in 10 minutes.</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="code">Verification code</Label>
                <Input
                  id="code"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="123456"
                  required
                  autoComplete="one-time-code"
                  disabled={loading}
                  className="text-center text-lg tracking-widest"
                />
              </div>

              {error && (
                <div className="flex items-start gap-2 text-sm text-red-600 bg-red-50 rounded-lg p-3">
                  <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <Button
                type="submit"
                className="w-full bg-teal-700 hover:bg-teal-800"
                disabled={loading || code.length !== 6}
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" /> Verifying...
                  </>
                ) : (
                  'Verify & Sign In'
                )}
              </Button>

              <button
                type="button"
                onClick={backToCredentials}
                className="w-full text-sm text-slate-500 hover:text-slate-700 flex items-center justify-center gap-1 pt-1"
              >
                <ArrowLeft className="w-3.5 h-3.5" /> Back to sign in
              </button>
            </form>
          )}

          {step === 'credentials' && (
            <div className="text-center pt-2 border-t">
              <p className="text-sm text-muted-foreground mb-1">Don't have an account?</p>
              <a
                href="https://magicalcrete.com/my-account"
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-teal-700 font-medium hover:underline"
              >
                Create your Free Magical Crete Account
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}