import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: './',
  build: {
    target: 'esnext',
  },
  worker: {
    format: 'es',
  },
  plugins: [
    VitePWA({
      registerType: 'prompt',
      includeAssets: [
        'favicon.svg',
        'icon.svg',
        'apple-touch-icon-180x180.png',
        'pwa-192x192.png',
        'pwa-512x512.png',
        'pwa-maskable-512x512.png',
      ],
      manifest: {
        id: './',
        name: 'Laser Trepanning & Ablation Calculator',
        short_name: 'LaserTrepan',
        description:
          'Diffraction-limited Gaussian beam optics, ablation threshold, and 3D precession trepanning calculator.',
        start_url: './',
        scope: './',
        display: 'standalone',
        theme_color: '#0f172a',
        background_color: '#0f172a',
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: 'pwa-maskable-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,wasm,svg,png,webmanifest}'],
        cleanupOutdatedCaches: true,
      },
    }),
  ],
});
