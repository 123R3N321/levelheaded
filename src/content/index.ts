import { isSafeToTap } from './eligibility'
import {
  getSettings,
  isActiveOn,
  onSettingsChanged,
  type Settings,
} from '../shared/settings'

/**
 * Preferred chain (M2): source → AudioWorklet (LevelerCore: gated AGC,
 * mid/side with speech-gated side ducking, lookahead limiter whose ceiling
 * rides recent program loudness) → destination.
 *
 * Fallback chain (M1): stock compressor + trim, used when a site's CSP
 * blocks loading the worklet module.
 */
type Chain =
  | { kind: 'worklet'; node: AudioWorkletNode }
  | { kind: 'compressor'; compressor: DynamicsCompressorNode; makeup: GainNode }

// Fallback tuning (see DESIGN.md M1.1): continuous flattening via low
// threshold + high ratio; the stock compressor's automatic makeup gain does
// the lifting, our explicit gain is a clip-safety trim.
const COMPRESS = { threshold: -45, knee: 15, ratio: 8, attack: 0.003, release: 0.3 }
const TRIM_GAIN = 0.95
const BYPASS = { threshold: 0, knee: 0, ratio: 1, attack: 0.003, release: 0.3 }

let ctx: AudioContext | null = null
let workletReady: Promise<boolean> | null = null
let settings: Settings | null = null
const chains = new WeakMap<HTMLMediaElement, Chain>()
let attachedCount = 0

function ensureContext(): AudioContext {
  if (!ctx) ctx = new AudioContext()
  if (ctx.state === 'suspended') {
    // Resume succeeds once the page has had a user gesture (pressing Play is
    // one). If we're attaching before that — e.g. muted autoplay — retry on
    // the next gesture.
    void ctx.resume()
    const retry = () => void ctx?.resume()
    document.addEventListener('pointerdown', retry, { once: true, capture: true })
    document.addEventListener('keydown', retry, { once: true, capture: true })
  }
  return ctx
}

/**
 * Load the worklet module once per page. Tries the extension URL first; some
 * sites' CSP rejects chrome-extension: script sources, so retry via a blob:
 * URL of the fetched source. Resolves false if both fail (→ compressor path).
 */
function ensureWorklet(audioCtx: AudioContext): Promise<boolean> {
  if (!workletReady) {
    workletReady = (async () => {
      const url = chrome.runtime.getURL('leveler-worklet.js')
      try {
        await audioCtx.audioWorklet.addModule(url)
        return true
      } catch {
        try {
          const source = await (await fetch(url)).text()
          const blobUrl = URL.createObjectURL(
            new Blob([source], { type: 'text/javascript' }),
          )
          await audioCtx.audioWorklet.addModule(blobUrl)
          URL.revokeObjectURL(blobUrl)
          return true
        } catch {
          return false
        }
      }
    })()
  }
  return workletReady
}

function active(): boolean {
  return settings !== null && isActiveOn(settings, location.hostname)
}

function applySettings(chain: Chain): void {
  if (chain.kind === 'worklet') {
    chain.node.port.postMessage({ type: 'bypass', value: !active() })
    return
  }
  const params = active() ? COMPRESS : BYPASS
  const { compressor, makeup } = chain
  compressor.threshold.value = params.threshold
  compressor.knee.value = params.knee
  compressor.ratio.value = params.ratio
  compressor.attack.value = params.attack
  compressor.release.value = params.release
  makeup.gain.value = active() ? TRIM_GAIN : 1
}

function reportStatus(): void {
  chrome.runtime
    .sendMessage({ type: 'status', attached: attachedCount, active: active() })
    .catch(() => {
      // Service worker may be asleep mid-navigation; badge catches up on the
      // next event.
    })
}

async function attach(el: HTMLMediaElement): Promise<void> {
  const audioCtx = ensureContext()
  const source = audioCtx.createMediaElementSource(el)

  let chain: Chain
  if (await ensureWorklet(audioCtx)) {
    const node = new AudioWorkletNode(audioCtx, 'levelheaded-leveler')
    source.connect(node)
    node.connect(audioCtx.destination)
    // The element's volume applies before our tap; the worklet divides it out
    // of its loudness measurement so the AGC never fights the player slider.
    const sendVolume = () => node.port.postMessage({ type: 'volume', value: el.volume })
    el.addEventListener('volumechange', sendVolume)
    sendVolume()
    chain = { kind: 'worklet', node }
  } else {
    const compressor = audioCtx.createDynamicsCompressor()
    const makeup = audioCtx.createGain()
    source.connect(compressor)
    compressor.connect(makeup)
    makeup.connect(audioCtx.destination)
    chain = { kind: 'compressor', compressor, makeup }
  }

  chains.set(el, chain)
  applySettings(chain)
  attachedCount++
  reportStatus()
}

function maybeAttach(el: EventTarget | null): void {
  if (!(el instanceof HTMLMediaElement)) return
  if (chains.has(el)) return
  if (!active()) return
  if (!isSafeToTap(el.currentSrc || el.src, location.origin)) return
  void attach(el)
}

function scanExisting(): void {
  for (const el of document.querySelectorAll('video, audio')) {
    const media = el as HTMLMediaElement
    if (!media.paused && media.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      maybeAttach(media)
    }
  }
}

async function main(): Promise<void> {
  settings = await getSettings()

  onSettingsChanged((next) => {
    settings = next
    // Already-attached chains flip between processing and transparent bypass;
    // detaching is impossible without a reload, by Web Audio design.
    for (const el of document.querySelectorAll('video, audio')) {
      const chain = chains.get(el as HTMLMediaElement)
      if (chain) applySettings(chain)
    }
    reportStatus()
  })

  // Media 'playing' events don't bubble, but a capture-phase listener on the
  // document still sees them for every descendant — present and future. This
  // replaces a MutationObserver and survives SPA navigations for free.
  document.addEventListener('playing', (e) => maybeAttach(e.target), true)

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scanExisting, { once: true })
  } else {
    scanExisting()
  }
}

void main()
