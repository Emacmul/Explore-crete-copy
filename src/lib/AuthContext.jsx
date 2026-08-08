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

  useEffect(() => {
    const storedToken = localStorage.getItem(TOKEN_KEY);
    const storedUser = localStorage.getItem(USER_KEY);

    if (storedToken && isTokenValid(storedToken) && storedUser) {
      try {
        const userData = JSON.parse(storedUser);
        setUser(userData);
        setToken(storedToken);
        setIsAuthenticated(true);
      } catch {
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(USER_KEY);
      }
    } else {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
    }
    setIsLoadingAuth(false);
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

    return userData;
  };

  const logout = () => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    setUser(null);
    setToken(null);
    setIsAuthenticated(false);
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