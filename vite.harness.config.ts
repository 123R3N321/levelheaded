import { defineConfig } from 'vite'

// Serves the manual listening harness (npm run harness). publicDir points at
// the repo's public/ so the page loads the same built worklet the extension
// ships.
export default defineConfig({
  root: 'harness',
  publicDir: '../public',
  server: { open: true },
})
