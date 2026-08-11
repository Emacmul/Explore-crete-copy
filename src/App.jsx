import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { pagesConfig } from './pages.config'
import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import { LanguageProvider } from '@/lib/i18n/LanguageContext';
import Login from './pages/Login';
import Narr from './pages/Narr';

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
      <Route path="/Login" element={<Login />} />
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
        </QueryClientProvider>
      </AuthProvider>
    </LanguageProvider>
  )
}

export default App