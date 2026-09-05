import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { pagesConfig } from './pages.config'
import { BrowserRouter as Router, Route, Routes, Navigate } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import { LanguageProvider } from '@/lib/i18n/LanguageContext';
import Login from './pages/Login';
import Narr from './pages/Narr';
import DebugConsoleOverlay from './components/DebugConsoleOverlay';
import UpdateAvailableToast from './components/UpdateAvailableToast';

const { Pages, Layout, mainPage } = pagesConfig;
const mainPageKey = mainPage ?? Object.keys(Pages)[0];
const MainPage = mainPageKey ? Pages[mainPageKey] : <></>;

const LayoutWrapper = ({ children, currentPageName }) => Layout ?
  <Layout currentPageName={currentPageName}>{children}</Layout>
  : <>{children}</>;

const AuthenticatedApp = () => {
  const { isLoadingAuth, isAuthenticated } = useAuth();

  // /Admin deliberately uses its own, separate Base44 staff login (checked inside the Admin page
  // itself) rather than the customer WordPress login this gate covers — so it must be allowed
  // through here regardless of customer auth state, or staff can never reach it at all.
  const isAdminPath = window.location.pathname.toLowerCase().startsWith('/admin');
  const isNarrPath = window.location.pathname.toLowerCase().startsWith('/narr');
  // About and Contact are public marketing/info pages — a prospective customer (or an app-store
  // reviewer) needs to reach these WITHOUT a WordPress account, so they're exempted from the
  // login gate the same way Admin/Narr are, just for the opposite reason (no login at all vs.
  // a different login).
  const isAboutPath = window.location.pathname.toLowerCase().startsWith('/about');
  const isContactPath = window.location.pathname.toLowerCase().startsWith('/contact');
  const isPublicPath = isAdminPath || isNarrPath || isAboutPath || isContactPath;

  if (isLoadingAuth && !isPublicPath) {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin"></div>
      </div>
    );
  }

  if (!isAuthenticated && !isPublicPath) {
    return <Login />;
  }

  return (
    <Routes>
      <Route path="/" element={
        <LayoutWrapper currentPageName={mainPageKey}>
          <MainPage />
        </LayoutWrapper>
      } />
      {Object.entries(Pages).map(([path, Page]) => (
        <Route
          key={path}
          path={`/${path}`}
          element={
            <LayoutWrapper currentPageName={path}>
              <Page />
            </LayoutWrapper>
          }
        />
      ))}
      <Route path="/Narr" element={<Narr />} />
      {/* Per Enda's report: the About/Contact pages' "back to app" link used to point
          straight at "/Login" (fixed in About.jsx/Contact.jsx), which — for someone
          already logged in — landed them on this exact raw login form with no way out:
          logging in again here doesn't go anywhere, because nothing ever moves the URL
          away from "/Login" itself. That's fixed at the source now, but this is a second,
          independent safety net: however someone reaches "/Login" (an old bookmark, the
          browser's own Back button, a future stray link), an already-authenticated visitor
          gets sent straight to the app's front page instead of being shown a login form
          they don't need and could get stuck on. */}
      <Route path="/Login" element={isAuthenticated ? <Navigate to="/" replace /> : <Login />} />
      <Route path="*" element={<PageNotFound />} />
    </Routes>
  );
};


function App() {

  return (
    <LanguageProvider>
      <AuthProvider>
        <QueryClientProvider client={queryClientInstance}>
          <Router>
            <AuthenticatedApp />
          </Router>
          <Toaster />
          <DebugConsoleOverlay />
          {/* Global, not tied to any one route — a narrator/admin left in the Admin Panel
              or Narr Studio for a while needs this exactly as much as a customer on the
              front end does. See UpdateAvailableToast.jsx for the full explanation. */}
          <UpdateAvailableToast />
        </QueryClientProvider>
      </AuthProvider>
    </LanguageProvider>
  )
}

export default App