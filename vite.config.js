import base44 from "@base44/vite-plugin"
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Per Enda: every code change deployed must show the "A new version is available"
// pop-up (UpdateAvailableToast.jsx) to anyone already using the app — a narrator or
// customer left working in a stale version, with no warning, is exactly what this is
// for. That banner only fires when public/sw.js's own bytes change (see that file's
// own comment for why — the browser detects a new service worker by literally
// byte-diffing this file). Hand-remembering to bump a version number in there before
// every deploy is exactly the kind of thing that gets forgotten under real workflow
// pressure — a quiet code fix pushed without that one extra edit would leave everyone
// already in the app none the wiser. So this plugin rewrites public/sw.js's own
// CACHE_VERSION constant to a fresh, unique value (the exact build timestamp) on every
// single production build, automatically — there is no longer a manual step to forget.
// `apply: 'build'` means this never touches the file while running the local dev
// server (`vite`/`npm run dev`), only on an actual `vite build` — matches
// registerSw.js's own existing "service worker only matters in production" split.
function bumpSwVersion() {
  return {
    name: 'bump-sw-version',
    apply: 'build',
    buildStart() {
      const swPath = path.resolve(__dirname, 'public/sw.js');
      if (!fs.existsSync(swPath)) return;
      const contents = fs.readFileSync(swPath, 'utf8');
      const freshVersion = `explore-crete-build-${Date.now()}`;
      const updated = contents.replace(
        /const CACHE_VERSION = '[^']*';/,
        `const CACHE_VERSION = '${freshVersion}';`
      );
      if (updated !== contents) fs.writeFileSync(swPath, updated);
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  logLevel: 'error', // Suppress warnings, only show errors
  plugins: [
    bumpSwVersion(),
    base44({
      // Support for legacy code that imports the base44 SDK with @/integrations, @/entities, etc.
      // can be removed if the code has been updated to use the new SDK imports from @base44/sdk
      legacySDKImports: process.env.BASE44_LEGACY_SDK_IMPORTS === 'true',
      hmrNotifier: true,
      navigationNotifier: true,
      analyticsTracker: true,
      visualEditAgent: true
    }),
    react(),
  ]
});