import React, { createContext, useState, useContext, useEffect } from 'react';
import { base44 } from '@/api/base44Client';

const AuthContext = createContext();

const TOKEN_KEY = 'explore_crete_token';
const USER_KEY = 'explore_crete_user';

const decodeJwt = (token) => {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    return JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
  } catch {
    return null;
  }
};

const isTokenValid = (token) => {
  if (!token) return false;
  const payload = decodeJwt(token);
  if (!payload) return false;
  if (payload.exp && Date.now() / 1000 > payload.exp) return false;
  return true;
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  // Admin/narrator role, looked up from Base44's own Users table by email —
  // see getUserRole. null = ordinary customer, no elevated access.
  const [role, setRole] = useState(null);

  // Looks up the current role for an email and updates state. Never throws —
  // a lookup failure just means no elevated access, same as no role at all.
  const refreshRole = async (email) => {
    if (!email) { setRole(null); return null; }
    try {
      const response = await base44.functions.invoke('getUserRole', { email });
      const fetchedRole = response.data?.role || null;
      setRole(fetchedRole);
      return fetchedRole;
    } catch {
      setRole(null);
      return null;
    }
  };

  useEffect(() => {
    const restore = async () => {
      const storedToken = localStorage.getItem(TOKEN_KEY);
      const storedUser = localStorage.getItem(USER_KEY);

      if (storedToken && isTokenValid(storedToken) && storedUser) {
        try {
          const userData = JSON.parse(storedUser);
          setUser(userData);
          setToken(storedToken);
          setIsAuthenticated(true);
          // Re-check role on every app load (not just at login) so a role
          // change made in Base44's Users panel takes effect the next time
          // the person opens the app, without needing to log in again.
          await refreshRole(userData.email);
        } catch {
          localStorage.removeItem(TOKEN_KEY);
          localStorage.removeItem(USER_KEY);
        }
      } else {
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(USER_KEY);
      }
      setIsLoadingAuth(false);
    };
    restore();
  }, []);

  const login = async (email, password) => {
    const response = await base44.functions.invoke('wpLogin', { email, password });
    const { token: wpToken, user: wpUser } = response.data;

    const userData = {
      id: wpUser.id,
      email: wpUser.email,
      full_name: wpUser.display_name || wpUser.username || wpUser.email,
      display_name: wpUser.display_name,
      username: wpUser.username
    };

    localStorage.setItem(TOKEN_KEY, wpToken);
    localStorage.setItem(USER_KEY, JSON.stringify(userData));

    setUser(userData);
    setToken(wpToken);
    setIsAuthenticated(true);
    await refreshRole(userData.email);

    return userData;
  };

  const logout = () => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    setUser(null);
    setToken(null);
    setIsAuthenticated(false);
    setRole(null);
  };

  const syncLibrary = async () => {
    if (!token) return null;
    const response = await base44.functions.invoke('syncLibrary', { token });
    return response.data;
  };

  return (
    <AuthContext.Provider value={{
      user,
      isAuthenticated,
      isLoadingAuth,
      token,
      role,
      isAdmin: role === 'admin',
      isNarrator: role === 'narrator',
      login,
      logout,
      syncLibrary
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};