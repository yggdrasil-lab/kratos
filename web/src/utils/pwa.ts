import { useState } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import {
  SW_UPDATE_POLL_INTERVAL_MS,
  usePwaUpdate as useSharedPwaUpdate,
  type UsePwaUpdateResult,
} from '@yggdrasil-lab/ui'

export { SW_UPDATE_POLL_INTERVAL_MS }
export type { UsePwaUpdateResult }

/**
 * Kratos service worker update hook wrapping vite-plugin-pwa's useRegisterSW
 * with the shared @yggdrasil-lab/ui update lifecycle manager.
 */
export function usePwaUpdate(): UsePwaUpdateResult {
  const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null)

  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_swUrl, reg) {
      if (reg) {
        setRegistration(reg)
      }
    },
    onRegisterError(error) {
      console.error('Service worker registration error:', error)
    },
  })

  return useSharedPwaUpdate({
    externalNeedRefresh: needRefresh,
    onExternalNeedRefreshChange: setNeedRefresh,
    updateServiceWorker,
    registration,
  })
}
