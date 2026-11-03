import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { App } from './App'
import { requestPersistence } from './db'
import { initGlobalErrorReporter } from './utils/telemetry'
import './index.css'

// Install global error reporter and unhandled rejection listeners
initGlobalErrorReporter()

const root = document.getElementById('root')
if (!root) throw new Error('#root is missing from index.html')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Ask at first run rather than assume iOS grants persistence by heuristic.
void requestPersistence()
