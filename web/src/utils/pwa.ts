import { useCallback, useEffect, useRef, useState } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'

export const SW_UPDATE_POLL_INTERVAL_MS = 60 * 60 * 1000

export function usePwaUpdate() {
  const registrationRef = useRef<ServiceWorkerRegistration | undefined>(undefined)
  const updateRequestedRef = useRef<boolean>(false)
  const messageTimerRef = useRef<number | undefined>(undefined)
  const [checkingForUpdate, setCheckingForUpdate] = useState<boolean>(false)
  const [updateCheckMessage, setUpdateCheckMessage] = useState<string | null>(null)

  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_swUrl, registration) {
      if (registration) {
        registrationRef.current = registration
        if (registration.waiting) {
          setNeedRefresh(true)
        }
      }
    },
    onRegisterError(error) {
      console.error('Service worker registration error:', error)
    },
  })

  const showTransientMessage = useCallback((msg: string) => {
    setUpdateCheckMessage(msg)
    if (messageTimerRef.current !== undefined) {
      window.clearTimeout(messageTimerRef.current)
    }
    messageTimerRef.current = window.setTimeout(() => {
      setUpdateCheckMessage(null)
    }, 3500)
  }, [])

  const getRegistration = useCallback(async (): Promise<ServiceWorkerRegistration | undefined> => {
    if (registrationRef.current) {
      return registrationRef.current
    }
    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.getRegistration()
      if (reg) {
        registrationRef.current = reg
        return reg
      }
    }
    return undefined
  }, [])

  const checkRegistrationForUpdate = useCallback(
    async (reg: ServiceWorkerRegistration): Promise<boolean> => {
      await reg.update()
      if (reg.waiting) {
        setNeedRefresh(true)
        return true
      }
      if (reg.installing) {
        const installingWorker = reg.installing
        await new Promise<void>((resolve) => {
          const onStateChange = () => {
            if (
              installingWorker.state === 'installed' ||
              installingWorker.state === 'activated' ||
              installingWorker.state === 'redundant'
            ) {
              installingWorker.removeEventListener('statechange', onStateChange)
              resolve()
            }
          }
          installingWorker.addEventListener('statechange', onStateChange)
        })
        if (reg.waiting) {
          setNeedRefresh(true)
          return true
        }
      }
      return false
    },
    [setNeedRefresh]
  )

  const triggerSilentUpdateCheck = useCallback(async () => {
    try {
      const reg = await getRegistration()
      if (!reg) return
      await checkRegistrationForUpdate(reg)
    } catch {
      // Ignore transient network errors during background/foreground SW checks
    }
  }, [getRegistration, checkRegistrationForUpdate])

  const checkForUpdates = useCallback(async () => {
    setCheckingForUpdate(true)
    setUpdateCheckMessage(null)
    try {
      const reg = await getRegistration()
      if (!reg) {
        showTransientMessage('Up to date')
        return
      }
      const found = await checkRegistrationForUpdate(reg)
      showTransientMessage(found ? 'Update ready' : 'Up to date')
    } catch {
      showTransientMessage('Update check failed')
    } finally {
      setCheckingForUpdate(false)
    }
  }, [getRegistration, checkRegistrationForUpdate, showTransientMessage])

  const applyUpdate = useCallback(async () => {
    updateRequestedRef.current = true
    const reg = await getRegistration()
    if (reg?.waiting) {
      reg.waiting.postMessage({ type: 'SKIP_WAITING' })
    }
    await updateServiceWorker(true)
  }, [getRegistration, updateServiceWorker])

  const dismissUpdate = useCallback(() => {
    setNeedRefresh(false)
  }, [setNeedRefresh])

  useEffect(() => {
    void triggerSilentUpdateCheck()

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void triggerSilentUpdateCheck()
      }
    }

    document.addEventListener('visibilitychange', onVisibilityChange)
    const intervalId = window.setInterval(() => {
      void triggerSilentUpdateCheck()
    }, SW_UPDATE_POLL_INTERVAL_MS)

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.clearInterval(intervalId)
      if (messageTimerRef.current !== undefined) {
        window.clearTimeout(messageTimerRef.current)
      }
    }
  }, [triggerSilentUpdateCheck])

  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
    let refreshing = false
    const onControllerChange = () => {
      if (!updateRequestedRef.current || refreshing) return
      refreshing = true
      window.location.reload()
    }
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange)
    return () => {
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange)
    }
  }, [])

  return {
    needRefresh,
    checkingForUpdate,
    updateCheckMessage,
    checkForUpdates,
    applyUpdate,
    dismissUpdate,
  }
}
