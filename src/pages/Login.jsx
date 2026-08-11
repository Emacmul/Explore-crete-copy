import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, AlertCircle } from 'lucide-react';

export default function Login() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login(email, password);
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Login failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-b from-teal-700 to-teal-900 p-6">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-white/10 backdrop-blur-sm mb-4">
            <img src="/explore-crete-logo.png" alt="Explore Crete" className="w-11 h-11 object-contain" />
          </div>
          <h1 className="text-2xl font-bold text-white">Explore Crete</h1>
          <p className="text-teal-200 text-sm mt-1">Walking, Hiking, WalkAbout, Driving</p>
        </div>

        <div className="bg-white rounded-2xl shadow-xl p-6 space-y-4">
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
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Signing in...
                </>
              ) : (
                'Sign In'
              )}
            </Button>
          </form>

          <div className="text-center pt-2 border-t">
            <p className="text-sm text-muted-foreground mb-1">Don't have an account?</p>
            <a
              href="https://magicalcrete.com/wp-login.php?action=register"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-teal-700 font-medium hover:underline"
            >
              Create your Free Magical Crete Account
            </a>
          </div>
        </div>

        <div className="flex items-center justify-center gap-4 mt-6 text-sm text-teal-200">
          <Link to="/About" className="hover:text-white hover:underline">About</Link>
          <span className="text-teal-400">·</span>
          <Link to="/Contact" className="hover:text-white hover:underline">Contact</Link>
        </div>
      </div>
    </div>
  );
}