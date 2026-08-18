import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Loader2 } from 'lucide-react';
import { createPageUrl } from '@/utils';
import BackendShell from '@/components/admin/BackendShell';

/**
 * Admin back end. Admins reach this via the "Admin" button and sign in with
 * Base44's own native login (separate from the customer WordPress login). Once
 * authenticated, the shared BackendShell renders in admin mode.
 */
export default function Admin() {
  const [user, setUser] = useState(null);
  const [userRole, setUserRole] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const checkAuth = async () => {
      try {
        const isAuth = await base44.auth.isAuthenticated();
        if (!isAuth) {
          base44.auth.redirectToLogin(window.location.href);
          return;
        }


        const userData = await base44.auth.me();

        let role = null;
        if (userData.role === 'admin') {
          role = 'admin';
        } else {
          const appUsers = await base44.entities.AppUser.filter({ email: String(userData.email || '').toLowerCase() });
          if (appUsers.length > 0 && (appUsers[0].role === 'narrator' || appUsers[0].role === 'admin')) {
            role = appUsers[0].role;
          }
        }

        if (!role) {
          window.location.href = createPageUrl('Home');
          return;
        }

        setUser(userData);
        setUserRole(role);
      } catch (error) {
        console.error('Auth check error:', error);
      } finally {
        setIsLoading(false);
      }
    };
    checkAuth();
  }, []);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <Loader2 className="w-10 h-10 animate-spin text-amber-400" />
      </div>
    );
  }

  if (!user) return null;

  const handleLogout = async () => {
    await base44.auth.logout();
    window.location.href = createPageUrl('Home');
  };

  return <BackendShell user={user} userRole={userRole} authMode="base44" onLogout={handleLogout} />;
}