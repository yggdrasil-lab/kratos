import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { App } from './App'
import { requestPersistence } from './db'
import './index.css'

const root = document.getElementById('root')
if (!root) throw new Error('#root is missing from index.html')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Ask at first run rather than assume iOS grants persistence by heuristic.
void requestPersistence()
