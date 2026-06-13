# LevelHeaded — Design

A Manifest V3 Chrome extension that continuously regulates streaming audio
with zero required user interaction: loud, overstimulating music and effects
are dampened throughout — not just at jump-scare spikes — while character
dialogue is lifted. Motivated by film mixes (e.g. *Charlie and the Chocolate
Factory*) where effects/score are far louder than dialogue, and by sensitivity
to sudden and sustained loud sound.

> Goal reframed after first listening tests (2026-06-12, Interstellar docking
> scene): dialogue lift already convincing in M1; loud-sound dampening must be
> markedly stronger, and regulation is continuous, not event-driven.

## Decisions

| Branch | Decision | Why |
| --- | --- | --- |
| Audio capture | Element-level Web Audio (`createMediaElementSource`) from the content script | Only fully automatic option. `tabCapture` is DRM-proof but requires a user gesture per tab. |
| Pre-emption | ~15 ms lookahead limiter in an AudioWorklet | Gain reduction computed on the un-delayed signal, applied to the delayed one — spikes are caught before they reach the ears. Audio lags video ~15 ms, far below the ~45 ms lip-sync threshold. Large lookahead would visibly desync lips. |
| Dialogue lift | Two-stage: slow AGC + limiter (M2) | A slow gain-rider (~4 s) steers loudness toward target so whisper scenes get +6–12 dB; the limiter hard-caps transients. Single compressor + makeup gain ships first (M1). |
| Site scope | All sites, auto-on for playing video | Works the day a new streamer appears. Music services ship default-disabled. |
| CORS risk | Pre-flight: only attach to `blob:`/`data:`/same-origin sources. M3 adds runtime silence detection → persist origin to a never-touch blocklist → auto-reload once | `createMediaElementSource` on non-CORS cross-origin media outputs silence irreversibly. |
| Volume slider | Compensate via `video.volume` forwarded to the worklet (M2) | The element's volume applies *before* our tap; an uncompensated AGC would fight the player's slider. |
| Silence gating | AGC freezes gain below ≈ −55 dBFS (M2) | Otherwise dramatic silence becomes amplified room-tone hiss. |
| Default tuning (M2 "normal") | AGC target ≈ −25 dBFS short-term, boost cap +12 dB, cut cap −15 dB, ~4 s adaptation; limiter/leveler keeps the loudest program ≤ ~6 dB above dialogue level, 15 ms lookahead | Strong leveling philosophy: audibly processed is acceptable — that *is* the product. Gentle (~10 dB window) / aggressive (~3 dB) presets bracket it. |
| Speech-aware processing (M2) | Mid/side split: constant mid (center/dialogue) boost + side shave; a speech-band energy detector on the mid channel (with ~100 ms hysteresis) ducks the side a further ~4–6 dB while dialogue is active | Film dialogue is center-panned; music/effects are stereo-spread. Delivers "duck the music under speech" with pure sample math — no ML. Mono content degrades gracefully (side = 0). Neural VAD / source separation parked unless this under-delivers. |
| Artifact priority | Flatness wins over pumping/breathing artifacts | Overstimulation is the problem being solved; a mildly audible gain ride is an acceptable price. Tune release/hysteresis to minimize, never at the cost of leveling. |
| UI | Minimal popup: global toggle, per-site toggle, strength slider (M3), gain-reduction meter (M3); badge shows active state | Defaults sensible, UI exists for trust and per-site overrides. |
| Stack | TypeScript + Vite + CRXJS, MV3 | Typed Web Audio/Chrome APIs, AudioWorklet bundling, HMR dev loop. |
| Distribution | Public GitHub repo; CI builds + release zips; load unpacked | Runtime can't be containerized (Chrome runs it); reproducibility via `.nvmrc` + lockfile + Linux CI runners. Users on any OS download the zip — no toolchain. |
| Settings | `chrome.storage.sync`; manifest `key` pinned so the extension ID (and therefore sync) is stable across machines | Owner uses Mac/Linux/Windows. |
| Verification | Local harness page with synthesized scenarios + numeric OfflineAudioContext unit tests (vitest); manual checklist on Netflix/YouTube | The target behavior is perceptual, but AGC/limiter responses to crafted input are computable. |

## Architecture

```
content script (all_urls, document_start)
  ├─ capture-phase 'playing' listener on document        — discovers every present & future media element
  ├─ eligibility check: blob:/data:/same-origin only     — avoids irreversible CORS silence
  ├─ per-element chain: MediaElementSource → [DSP] → destination
  │     M1 DSP: DynamicsCompressorNode + makeup GainNode
  │     M2 DSP: AudioWorklet { AGC (gated, volume-compensated) → 15 ms lookahead limiter }
  ├─ chrome.storage.sync settings; "off" = transparent bypass (detach impossible by spec)
  └─ status messages → service worker → per-tab badge

popup: global toggle, per-site toggle (writes storage; content reacts via onChanged)
```

## Milestones

- **M1 — skeleton (done first):** attach to playing media, stock compressor +
  makeup gain, popup toggles, badge, music-site default-off list, CI.
- **M1.1 — hot-fix (done):** stronger static curve (threshold −45, ratio 8)
  so continued listening tests measure the continuous-regulation philosophy.
- **M2 — the real DSP (done):** AudioWorklet (pure-TS `LevelerCore`, fully
  unit-testable) with slow AGC (silence-gated, `video.volume`-compensated) +
  15 ms lookahead limiter + mid/side processing with speech-gated side
  ducking; listening harness (`npm run harness`) + numeric vitest coverage;
  tuning constants in one module (`src/audio/tuning.ts`). The limiter ceiling
  rides the rolling program loudness (+`windowDb`), so a spike is defined
  relative to playback continuity, not an absolute level. The baseline is
  tracked in the log domain — a power-domain EMA would chase a +26 dB burst
  within milliseconds and defeat the clamp (caught by the test suite).
  Falls back to the M1 compressor chain on sites whose CSP blocks worklet
  loading.
- **M3 — robustness & trust:** runtime silence detection → origin blocklist →
  one-time auto-reload; strength slider (gentle/normal/aggressive);
  live gain-reduction meter in the popup; icons.

## Accepted limitations

- Chromecast sessions are untouched — audio never reaches the local machine.
- A wrong CORS guess costs one automatic page reload per origin, ever (M3).
- `<all_urls>` would need permission rework for a Chrome Web Store release.
- The sound is audibly processed at the default strength, by design.
- Once attached, a chain persists until page reload ("off" = transparent bypass).
