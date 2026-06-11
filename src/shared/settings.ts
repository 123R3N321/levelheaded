/** Settings shared between the popup and content scripts via chrome.storage.sync. */
export interface Settings {
  /** Master switch. */
  enabled: boolean
  /** Hostnames where processing is switched off. */
  disabledSites: string[]
}

/**
 * Music services ship default-disabled: dynamic-range compression is exactly
 * what you don't want on music. Users can re-enable per site from the popup.
 */
export const DEFAULT_DISABLED_SITES = [
  'open.spotify.com',
  'music.youtube.com',
  'soundcloud.com',
  'bandcamp.com',
  'music.apple.com',
  'tidal.com',
]

export const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  disabledSites: DEFAULT_DISABLED_SITES,
}

export async function getSettings(): Promise<Settings> {
  const stored = await chrome.storage.sync.get({ ...DEFAULT_SETTINGS })
  return stored as unknown as Settings
}

export async function setSettings(patch: Partial<Settings>): Promise<void> {
  await chrome.storage.sync.set(patch)
}

export function onSettingsChanged(callback: (settings: Settings) => void): void {
  chrome.storage.sync.onChanged.addListener(() => {
    void getSettings().then(callback)
  })
}

export function isActiveOn(settings: Settings, hostname: string): boolean {
  return settings.enabled && !settings.disabledSites.includes(hostname)
}
