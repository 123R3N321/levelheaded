/**
 * Service worker: reflects per-tab processing state on the toolbar badge.
 *  - green "ON" with a count of tapped media elements when actively processing
 *  - no badge when idle or disabled on the site
 */
chrome.runtime.onMessage.addListener((message, sender) => {
  if (message?.type !== 'status' || sender.tab?.id === undefined) return
  const tabId = sender.tab.id
  const { attached, active } = message as { attached: number; active: boolean }

  if (active && attached > 0) {
    void chrome.action.setBadgeBackgroundColor({ tabId, color: '#1a7f37' })
    void chrome.action.setBadgeText({ tabId, text: 'ON' })
    void chrome.action.setTitle({
      tabId,
      title: `LevelHeaded — leveling ${attached} player${attached > 1 ? 's' : ''}`,
    })
  } else {
    void chrome.action.setBadgeText({ tabId, text: '' })
    void chrome.action.setTitle({ tabId, title: 'LevelHeaded' })
  }
})
