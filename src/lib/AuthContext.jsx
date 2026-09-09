import React, { createContext, useState, useContext, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { getDeviceId, getDeviceLabel } from '@/lib/deviceId';

const AuthContext = createContext();

const TOKEN_KEY = 'explore_crete_token';
const USER_KEY = 'explore_crete_user';

// How often a signed-in session pings the server to prove it's still open — must stay
// comfortably under deviceAuth.ts's SESSION_TIMEOUT_MIN (20 min) so a session doesn't go
// stale just because a background/mobile tab throttled the interval by a minute or two.
const HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000;

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

  // Finishes a successful login (either straight through, or after a device code was
  // verified) — stores the token/user and marks the session authenticated.
  const completeLogin = (data) => {
    const { token: wpToken, user: wpUser } = data;

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

    return { challengeRequired: false, user: userData };
  };

  // Per Enda (audit finding U-01, 2026-09-09 review): this now goes through the real
  // device-check flow (loginWithDeviceCheck) instead of calling wpLogin directly — a known
  // device on an account with no other active session signs straight in exactly as before;
  // a NEW device gets an emailed one-time code first (see verifyDeviceCode below), and a
  // second device trying to sign in while another is already active is refused with a clear
  // message, both enforced server-side. Admin/narrator staff accounts are exempted from all
  // of this on the backend (see loginWithDeviceCheck's own comment) — nothing to handle here.
  const login = async (email, password) => {
    const response = await base44.functions.invoke('loginWithDeviceCheck', {
      email,
      password,
      device_id: getDeviceId(),
      device_label: getDeviceLabel(),
    });
    const data = response.data;
    if (data?.status === 'challenge_required') {
      return { challengeRequired: true, expiresAt: data.expires_at };
    }
    return completeLogin(data);
  };

  // Step 2 of a new-device sign-in: submits the code the user got by email, alongside the
  // same email/password (the server re-validates them to mint a fresh token — a stale
  // password left sitting in the browser while the email loads isn't trusted on its own).
  const verifyDeviceCode = async (email, password, code) => {
    const response = await base44.functions.invoke('verifyDeviceCode', {
      email,
      password,
      code,
      device_id: getDeviceId(),
      device_label: getDeviceLabel(),
    });
    return completeLogin(response.data);
  };

  const logout = () => {
    const deviceId = getDeviceId();
    const currentToken = token;

    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    setUser(null);
    setToken(null);
    setIsAuthenticated(false);

    // Best-effort, fire-and-forget: releases the concurrent-session lock right away so
    // switching to a different device doesn't force a wait for the 20-minute session
    // timeout. Never blocks signing out even if this fails.
    if (currentToken) {
      base44.functions.invoke('sessionEnd', { token: currentToken, device_id: deviceId }).catch(() => {});
    }
  };

  // Keeps the session's ActiveSession record alive while the app is open — see
  // deviceAuth.ts's SESSION_TIMEOUT_MIN. Runs for both a fresh login and a session restored
  // from localStorage on page load; stops automatically on logout.
  useEffect(() => {
    if (!isAuthenticated || !token) return;
    const deviceId = getDeviceId();
    const send = () => {
      base44.functions.invoke('sessionHeartbeat', { token, device_id: deviceId }).catch(() => {});
    };
    const id = setInterval(send, HEARTBEAT_INTERVAL_MS);
    return () => clearInterval(id);
  }, [isAuthenticated, token]);

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
      verifyDeviceCode,
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