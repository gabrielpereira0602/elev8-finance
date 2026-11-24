import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { readFileSync, writeFileSync } from 'node:fs';

export default defineConfig({
  plugins: [
    preact(),
    {
      name: 'sw-version',
      closeBundle() {
        const f = 'dist/sw.js';
        writeFileSync(f, readFileSync(f, 'utf8').replace('__BUILD__', Date.now().toString(36)));
      },
    },
  ],
  server: { proxy: { '/api': 'http://127.0.0.1:8099' } },
  build: { target: 'es2020', sourcemap: false },
  test: { environment: 'node' },
} as any);
