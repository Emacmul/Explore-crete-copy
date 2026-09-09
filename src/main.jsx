import React from 'react'
import ReactDOM from 'react-dom/client'
import App from '@/App.jsx'
import '@/index.css'
import { registerServiceWorker } from '@/lib/registerSw'

// Per audit finding U-03 (2026-09-09 code review): this function existed, fully written,
// but was never actually called anywhere — so the app's own "keep working with no
// signal" safety promise (see public/sw.js) never took effect for real users. Fired here,
// at the very top of startup, same place any production app registers its service
// worker. Safe to call unconditionally — the function itself already no-ops in dev and
// only registers in a production build (see registerSw.js's own header comment).
registerServiceWorker()

ReactDOM.createRoot(document.getElementById('root')).render(
  <App />
)
