import { isSafeToTap } from './eligibility'
import {
  getSettings,
  isActiveOn,
  onSettingsChanged,
  type Settings,
} from '../shared/settings'

/**
 * M1 processing chain: source → DynamicsCompressorNode → makeup gain → out.
 *
 * The stock compressor with a fast attack catches loud transients; the makeup
 * gain lifts the (now headroom-rich) signal so quiet dialogue lands louder.
 * M2 replaces this with an AudioWorklet implementing the real two-stage
 * AGC + lookahead limiter from DESIGN.md.
 */
interface Chain {
  compressor: DynamicsCompressorNode
  makeup: GainNode
}

// Tuned for continuous regulation, not just spike-catching: low threshold +
// high ratio flatten sustained loud score/effects, per first listening tests
// (Interstellar docking scene: dialogue lift good, dampening too weak).
// Chrome's DynamicsCompressorNode applies automatic makeup gain, which grows
// with these settings — so the explicit gain is now a slight safety trim
// against clipping rather than a boost.
const COMPRESS = { threshold: -45, knee: 15, ratio: 8, attack: 0.003, release: 0.3 }
const MAKEUP_GAIN = 0.95
// Transparent settings used while the extension is toggled off — the graph
// connection is irreversible, so "off" means "audibly do nothing".
const BYPASS = { threshold: 0, knee: 0, ratio: 1, attack: 0.003, release: 0.25 }

let ctx: AudioContext | null = null
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

function applySettings(chain: Chain): void {
  if (!settings) return
  const params = isActiveOn(settings, location.hostname) ? COMPRESS : BYPASS
  const gain = isActiveOn(settings, location.hostname) ? MAKEUP_GAIN : 1
  const { compressor, makeup } = chain
  compressor.threshold.value = params.threshold
  compressor.knee.value = params.knee
  compressor.ratio.value = params.ratio
  compressor.attack.value = params.attack
  compressor.release.value = params.release
  makeup.gain.value = gain
}

function reportStatus(): void {
  const active = settings !== null && isActiveOn(settings, location.hostname)
  chrome.runtime
    .sendMessage({ type: 'status', attached: attachedCount, active })
    .catch(() => {
      // Service worker may be asleep mid-navigation; badge catches up on the
      // next event.
    })
}

function maybeAttach(el: EventTarget | null): void {
  if (!(el instanceof HTMLMediaElement)) return
  if (chains.has(el)) return
  if (!settings || !isActiveOn(settings, location.hostname)) return
  if (!isSafeToTap(el.currentSrc || el.src, location.origin)) return

  const audioCtx = ensureContext()
  const source = audioCtx.createMediaElementSource(el)
  const compressor = audioCtx.createDynamicsCompressor()
  const makeup = audioCtx.createGain()
  source.connect(compressor)
  compressor.connect(makeup)
  makeup.connect(audioCtx.destination)

  const chain: Chain = { compressor, makeup }
  chains.set(el, chain)
  applySettings(chain)
  attachedCount++
  reportStatus()
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
