import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// The API is same-origin in production (Traefik routes /api to the service) and
// proxied to uvicorn in development, so the client never needs an absolute URL.
const API_TARGET = process.env.KRATOS_API_TARGET ?? 'http://localhost:8000'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // autoUpdate: new service workers activate immediately. With 'prompt' they sat in
      // 'waiting' forever in standalone home-screen PWAs, serving stale bundles.
      registerType: 'autoUpdate',
      includeAssets: [
        'favicon.svg',
        'apple-touch-icon.png',
        'apple-touch-icon-precomposed.png',
        'apple-touch-icon-180x180.png',
        'apple-touch-icon-180x180-precomposed.png',
        'apple-touch-icon-120x120.png',
      ],
      manifest: {
        name: 'Kratos',
        short_name: 'Kratos',
        description: 'Workout catalogue, plans, and logged sessions.',
        theme_color: '#0f172a',
        background_color: '#0f172a',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'pwa-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // The shell is precached; the data layer is Dexie, not the cache.
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallbackDenylist: [/^\/api\//],
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
      },
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: API_TARGET,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
})
