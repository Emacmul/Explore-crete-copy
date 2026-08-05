import React, { createContext, useState, useContext, useEffect } from 'react';
import { base44 } from '@/api/base44Client';

const AuthContext = createContext();

const TOKEN_KEY = 'explore_crete_token';
const USER_KEY = 'explore_crete_user';
const DEVICE_ID_KEY = 'explore_crete_device_id';

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

// Generate / retrieve a stable, anonymous device ID for this install.
const getOrCreateDeviceId = () => {
  let id = localStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = (crypto?.randomUUID?.() || (Date.now().toString(36) + Math.random().toString(36).slice(2)));
    localStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
};

// A short, human-readable hint (e.g. "Chrome on iOS") for the admin device list.
const getDeviceLabel = () => {
  try {
    const ua = navigator.userAgent;
    let os = 'Device';
    if (/iPhone|iPad|iPod/i.test(ua)) os = 'iOS';
    else if (/Android/i.test(ua)) os = 'Android';
    else if (/Windows/i.test(ua)) os = 'Windows';
    else if (/Macintosh|Mac OS/i.test(ua)) os = 'macOS';
    else if (/Linux/i.test(ua)) os = 'Linux';
    let browser = 'Browser';
    if (/Edg/i.test(ua)) browser = 'Edge';
    else if (/Chrome/i.test(ua)) browser = 'Chrome';
    else if (/Safari/i.test(ua)) browser = 'Safari';
    else if (/Firefox/i.test(ua)) browser = 'Firefox';
    return `${browser} on ${os}`;
  } catch {
    return 'Unknown device';
  }
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

  const completeLogin = (wpToken, wpUser) => {
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

  // Step 1 of the protected login flow. Validates credentials, then either
  // completes the login (known device) or returns a "challenge required" result
  // so the UI can show the email-code step.
  const login = async (email, password) => {
    const device_id = getOrCreateDeviceId();
    const device_label = getDeviceLabel();
    const response = await base44.functions.invoke('loginWithDeviceCheck', { email, password, device_id, device_label });
    const data = response?.data !== undefined ? response.data : response;

    if (data.status === 'challenge_required') {
      return { challengeRequired: true, expires_at: data.expires_at };
    }
    if (data.status === 'ok' && data.token) {
      completeLogin(data.token, data.user);
      return { challengeRequired: false };
    }
    throw new Error(data.error || 'Login failed. Please try again.');
  };

  // Step 2: verify the emailed code for a new device, then complete login.
  const verifyCode = async (email, password, code) => {
    const device_id = getOrCreateDeviceId();
    const device_label = getDeviceLabel();
    const response = await base44.functions.invoke('verifyDeviceCode', { email, password, device_id, code, device_label });
    const data = response?.data !== undefined ? response.data : response;

    if (data.status === 'ok' && data.token) {
      completeLogin(data.token, data.user);
      return;
    }
    throw new Error(data.error || 'Verification failed. Please try again.');
  };

  const logout = () => {
    // Best-effort: tell the backend to end this device's active session.
    try {
      if (user?.email) {
        base44.functions.invoke('sessionEnd', { email: user.email, device_id: getOrCreateDeviceId() }).catch(() => {});
      }
    } catch { /* ignore — local logout proceeds regardless */ }
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

  // Heartbeat: keep this device's session marked active while the app is open.
  useEffect(() => {
    if (!isAuthenticated || !user?.email) return;
    const sendBeat = () => {
      base44.functions.invoke('sessionHeartbeat', { email: user.email, device_id: getOrCreateDeviceId() }).catch(() => {});
    };
    sendBeat();
    const interval = setInterval(sendBeat, 5 * 60 * 1000); // every 5 minutes
    return () => clearInterval(interval);
  }, [isAuthenticated, user]);

  return (
    <AuthContext.Provider value={{
      user,
      isAuthenticated,
      isLoadingAuth,
      token,
      login,
      verifyCode,
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