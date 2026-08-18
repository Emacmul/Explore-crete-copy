import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, AlertCircle, Eye, EyeOff } from 'lucide-react';
import { useLanguage } from '@/lib/i18n/LanguageContext';

export default function Login() {
  const { login } = useAuth();
  const { t } = useLanguage();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login(email, password);
    } catch (err) {
      setError(err.response?.data?.error || err.message || t('login.failedDefault'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-b from-teal-700 to-teal-900 p-6">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-white/10 backdrop-blur-sm mb-4">
            <img src="/explore-crete-logo.png" alt={t('app.title')} className="w-11 h-11 object-contain" />
          </div>
          <h1 className="text-2xl font-bold text-white">{t('app.title')}</h1>
          <p className="text-teal-200 text-sm mt-1">{t('login.tagline')}</p>
        </div>

        <div className="bg-white rounded-2xl shadow-xl p-6 space-y-4">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">{t('login.email')}</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t('login.emailPlaceholder')}
                required
                autoComplete="email"
                disabled={loading}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">{t('login.password')}</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={t('login.passwordPlaceholder')}
                  required
                  autoComplete="current-password"
                  disabled={loading}
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  aria-label={showPassword ? t('login.hidePassword') : t('login.showPassword')}
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
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
              disabled={loading || !email || !password}
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  {t('login.signingIn')}
                </>
              ) : (
                t('login.signIn')
              )}
            </Button>
          </form>

          <div className="text-center pt-2 border-t">
            <p className="text-sm text-muted-foreground mb-1">{t('login.noAccount')}</p>
            <a
              href="https://magicalcrete.com/wp-login.php?action=register"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-teal-700 font-medium hover:underline"
            >
              {t('login.createAccount')}
            </a>
          </div>
        </div>

        <div className="flex items-center justify-center gap-4 mt-6 text-sm text-teal-200">
          <Link to="/About" className="hover:text-white hover:underline">{t('footer.about')}</Link>
          <span className="text-teal-400">·</span>
          <Link to="/Contact" className="hover:text-white hover:underline">{t('footer.contact')}</Link>
        </div>
      </div>
    </div>
  );
}
