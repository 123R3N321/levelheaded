# LevelHeaded — Design

A Manifest V3 Chrome extension that automatically tames loud sound effects and
lifts quiet dialogue on any site playing video, with zero required user
interaction. Motivated by film mixes (e.g. *Charlie and the Chocolate
Factory*) where effects/score are far louder than dialogue, and by sensitivity
to sudden loud sounds.

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
| Default tuning (M2 "normal") | AGC target ≈ −25 dBFS short-term, boost cap +12 dB, cut cap −15 dB, ~4 s adaptation; limiter ceiling ~8 dB above target, 15 ms lookahead | Strong leveling philosophy: audibly processed is acceptable — that *is* the product. Gentle/aggressive presets bracket it. |
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
- **M2 — the real DSP:** AudioWorklet with slow AGC (silence-gated,
  `video.volume`-compensated) + 15 ms lookahead limiter; harness page +
  numeric vitest coverage; tuning constants in one module.
- **M3 — robustness & trust:** runtime silence detection → origin blocklist →
  one-time auto-reload; strength slider (gentle/normal/aggressive);
  live gain-reduction meter in the popup; icons.

## Accepted limitations

- Chromecast sessions are untouched — audio never reaches the local machine.
- A wrong CORS guess costs one automatic page reload per origin, ever (M3).
- `<all_urls>` would need permission rework for a Chrome Web Store release.
- The sound is audibly processed at the default strength, by design.
- Once attached, a chain persists until page reload ("off" = transparent bypass).
