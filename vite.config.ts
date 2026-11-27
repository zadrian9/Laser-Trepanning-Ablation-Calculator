import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

function resolveBasePath(): string {
  const raw = (process.env.VITE_BASE_PATH || process.env.BASE_PATH || '').trim();
  if (!raw || raw === './') return './';
  if (raw === '/') return '/';
  const trimmed = raw.replace(/^\/+|\/+$/g, '');
  return trimmed ? `/${trimmed}/` : '/';
}

const basePath = resolveBasePath();

export default defineConfig({
  base: basePath,
  build: {
    target: 'esnext',
  },
  worker: {
    format: 'es',
  },
  plugins: [
    VitePWA({
      registerType: 'prompt',
      manifest: {
        id: basePath,
        name: 'Laser Trepanning & Ablation Calculator',
        short_name: 'LaserTrepan',
        description:
          'Diffraction-limited Gaussian beam optics, ablation threshold, and 3D precession trepanning calculator.',
        start_url: basePath,
        scope: basePath,
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
        globIgnores: ['pwa-*.png', 'manifest.webmanifest'],
        cleanupOutdatedCaches: true,
      },
    }),
  ],
});
