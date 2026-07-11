import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['**/*.{png,svg}'],
      manifest: {
        name: 'Chekaz - Checkers',
        short_name: 'Chekaz',
        description: 'Premium checkers game',
        theme_color: '#1a1510',
        background_color: '#1a1510',
        display: 'standalone',
        orientation: 'any',
        icons: [
          { src: '/chekaz.png', sizes: '192x192', type: 'image/png' },
          { src: '/chekaz.png', sizes: '512x512', type: 'image/png' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg}'],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-cache',
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
        ],
      },
    }),
  ],
})
