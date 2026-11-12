import { defineConfig, mergeConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import base from '../vite.config.mjs';

export default mergeConfig(base, defineConfig({
  resolve: { alias: [{ find: /^agentation$/, replacement: fileURLToPath(new URL('./agentation-disabled.mjs', import.meta.url)) }] },
}));
