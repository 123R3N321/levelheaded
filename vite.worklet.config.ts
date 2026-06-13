import { defineConfig } from 'vite'

// Builds the AudioWorklet processor as a single self-contained module into
// public/, which Vite copies verbatim into dist/. The content script loads it
// via chrome.runtime.getURL('leveler-worklet.js') (web_accessible_resources).
export default defineConfig({
  build: {
    lib: {
      entry: 'src/audio/leveler-worklet.ts',
      formats: ['es'],
      fileName: () => 'leveler-worklet.js',
    },
    outDir: 'public',
    emptyOutDir: false,
    target: 'es2022',
  },
})
