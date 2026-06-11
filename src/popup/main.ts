import { getSettings, setSettings } from '../shared/settings'

const globalToggle = document.getElementById('global-toggle') as HTMLInputElement
const siteToggle = document.getElementById('site-toggle') as HTMLInputElement
const siteName = document.getElementById('site-name') as HTMLElement
const hint = document.getElementById('status-hint') as HTMLElement

async function currentHostname(): Promise<string | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!tab?.url) return null
  try {
    const url = new URL(tab.url)
    return url.protocol.startsWith('http') ? url.hostname : null
  } catch {
    return null
  }
}

function updateHint(enabled: boolean, siteOn: boolean): void {
  hint.textContent = !enabled
    ? 'Paused everywhere.'
    : siteOn
      ? 'Changes apply to already-playing video immediately.'
      : 'Disabled on this site. Other sites are unaffected.'
}

async function main(): Promise<void> {
  const hostname = await currentHostname()
  const settings = await getSettings()

  globalToggle.checked = settings.enabled

  if (hostname) {
    siteName.textContent = hostname
    siteToggle.checked = !settings.disabledSites.includes(hostname)
  } else {
    siteToggle.disabled = true
    siteName.textContent = 'this page'
  }

  updateHint(globalToggle.checked, siteToggle.checked)

  globalToggle.addEventListener('change', () => {
    void setSettings({ enabled: globalToggle.checked })
    updateHint(globalToggle.checked, siteToggle.checked)
  })

  siteToggle.addEventListener('change', () => {
    void (async () => {
      const { disabledSites } = await getSettings()
      const next = siteToggle.checked
        ? disabledSites.filter((site) => site !== hostname)
        : [...disabledSites, hostname!]
      await setSettings({ disabledSites: next })
      updateHint(globalToggle.checked, siteToggle.checked)
    })()
  })
}

void main()
