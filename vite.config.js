import { resolve } from 'node:path'
import { defineConfig } from 'vite'

export default defineConfig({
  base: './',
  build: {
    rollupOptions: {
      input: ['index', 'scorebord', 'beheer', 'voorwaarden', 'privacy'].map((p) => resolve(`${p}.html`)),
    },
  },
})
