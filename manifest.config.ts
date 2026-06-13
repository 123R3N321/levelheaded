import { defineManifest } from '@crxjs/vite-plugin'

import pkg from './package.json'

// Pinning `key` keeps the extension ID identical on every machine that loads
// the unpacked build, which is required for chrome.storage.sync to share
// settings across installs. This is the PUBLIC key; the private half (key.pem)
// is gitignored and only needed if we ever pack a .crx.
const PUBLIC_KEY =
  'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA99NfUutJcUynMbJ6eAchd+HluxT6YanfUgE57mFUvHObu4P5g1XWW3ZC3fKiRlqx2p8Y6HAHzYrhlIQaMTq36PKTFwU4RsGFTTpezJuY4oFCRw+EK/xpz/JTu6k2BTiS3sptkiOCjO3XOtRJONx/eINV2jhXJhppNBI1V/GF7S4axbMfh1D1kVmPOlWacvYp/tfzR951DyCguqLMh1VYeEtGaaa/7cc7c+xMMDXefF6YKuFm957P5My2PlrreF7rEmPZCQqwa8QElGhIx3suUSZu93iTmgrBa4AgFQuI1Ckb5PVcXej5v+/AQ+7RiZlxBurf4TS83gimivOfjJAXxQIDAQAB'

export default defineManifest({
  manifest_version: 3,
  name: 'LevelHeaded',
  version: pkg.version,
  description:
    'Automatically tames loud sound effects and lifts quiet dialogue while you stream. No jump-scare stingers, no subtitle-squinting whispers.',
  key: PUBLIC_KEY,
  permissions: ['storage', 'activeTab'],
  background: {
    service_worker: 'src/background.ts',
    type: 'module',
  },
  content_scripts: [
    {
      matches: ['<all_urls>'],
      js: ['src/content/index.ts'],
      run_at: 'document_start',
      all_frames: true,
    },
  ],
  action: {
    default_popup: 'src/popup/index.html',
    default_title: 'LevelHeaded',
  },
  web_accessible_resources: [
    {
      // The AudioWorklet module, loaded into page AudioContexts by the
      // content script.
      resources: ['leveler-worklet.js'],
      matches: ['<all_urls>'],
    },
  ],
})
