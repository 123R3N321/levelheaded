import { describe, expect, it } from 'vitest'

import { LevelerCore } from '../src/audio/leveler-core'
import { TUNING, dbToLin, linToDb } from '../src/audio/tuning'

const SR = 48000
const BLOCK = 128

/** Drive `core` with per-sample generators, returning all output blocks. */
function run(
  core: LevelerCore,
  seconds: number,
  gen: { left: (t: number) => number; right?: (t: number) => number },
  collect = false,
): Float32Array[] {
  const blocks = Math.floor((seconds * SR) / BLOCK)
  const stereo = gen.right !== undefined
  const inBufs = [new Float32Array(BLOCK), new Float32Array(BLOCK)].slice(0, stereo ? 2 : 1)
  const collected: Float32Array[] = []
  let sample = 0
  for (let b = 0; b < blocks; b++) {
    const outBufs = [new Float32Array(BLOCK), new Float32Array(BLOCK)].slice(0, stereo ? 2 : 1)
    for (let i = 0; i < BLOCK; i++) {
      const t = sample++ / SR
      inBufs[0][i] = gen.left(t)
      if (stereo) inBufs[1][i] = gen.right!(t)
    }
    core.process(inBufs, outBufs)
    if (collect) collected.push(...outBufs)
  }
  return collected
}

/** Sine generator with a given RMS level in dBFS. */
const sine = (freq: number, rmsDb: number) => {
  const amp = dbToLin(rmsDb) * Math.SQRT2
  return (t: number) => amp * Math.sin(2 * Math.PI * freq * t)
}

const rmsDb = (bufs: Float32Array[]): number => {
  let sum = 0
  let n = 0
  for (const buf of bufs) {
    for (const v of buf) sum += v * v
    n += buf.length
  }
  return 10 * Math.log10(sum / n + 1e-12)
}

const peak = (bufs: Float32Array[]): number => {
  let p = 0
  for (const buf of bufs) for (const v of buf) p = Math.max(p, Math.abs(v))
  return p
}

describe('AGC', () => {
  it('lifts quiet program toward the target', () => {
    const core = new LevelerCore(SR)
    run(core, 15, { left: sine(440, -33) }) // converge
    const out = run(core, 2, { left: sine(440, -33) }, true)
    // -33 dB needs +8 dB to reach -25; mid boost adds ~3 — allow the window.
    expect(rmsDb(out)).toBeGreaterThan(TUNING.targetDb - 3)
    expect(rmsDb(out)).toBeLessThan(TUNING.targetDb + 5)
  })

  it('cuts loud program toward the target', () => {
    const core = new LevelerCore(SR)
    run(core, 15, { left: sine(440, -12) })
    const out = run(core, 2, { left: sine(440, -12) }, true)
    expect(rmsDb(out)).toBeLessThan(TUNING.targetDb + 6)
  })

  it('respects the boost cap on very quiet program', () => {
    const core = new LevelerCore(SR)
    run(core, 20, { left: sine(440, -48) })
    expect(core.agcGainDb).toBeLessThanOrEqual(TUNING.maxBoostDb + 0.5)
  })

  it('freezes below the gate instead of amplifying silence', () => {
    const core = new LevelerCore(SR)
    run(core, 10, { left: sine(440, -33) })
    const gainBefore = core.agcGainDb
    // Near-silence (room tone at -75 dB). During the ~1.5s fade transition
    // the detector is still above the gate and the AGC may legitimately ride
    // up a little — but it must freeze well short of the boost cap instead
    // of winding to maximum and amplifying room tone.
    run(core, 5, { left: sine(440, -75) })
    const drift = core.agcGainDb - gainBefore
    expect(drift).toBeLessThan(4)
    const frozen = core.agcGainDb
    run(core, 5, { left: sine(440, -75) })
    expect(Math.abs(core.agcGainDb - frozen)).toBeLessThan(0.1)
  })
})

describe('lookahead limiter — ceiling rides recent program loudness', () => {
  /** Converge on `contextDb` program, then fire a -6 dB burst; return its output peak. */
  function burstPeakAfterContext(contextDb: number): number {
    const core = new LevelerCore(SR)
    run(core, 15, { left: sine(440, contextDb) })
    const out = run(core, 0.25, { left: sine(440, -6) }, true)
    return peak(out)
  }

  it('clamps a sudden burst relative to what preceded it', () => {
    const quietContext = burstPeakAfterContext(-45)
    const normalContext = burstPeakAfterContext(-30)
    // The same burst must come out QUIETER after a quiet passage than after
    // louder program — the relative, continuity-based dampening.
    expect(linToDb(quietContext)).toBeLessThan(linToDb(normalContext) - 3)
  })

  it('keeps the burst within the window above the running program level', () => {
    const core = new LevelerCore(SR)
    run(core, 15, { left: sine(440, -45) })
    const programDb = -45 + core.agcGainDb // post-AGC running level
    const out = run(core, 0.25, { left: sine(440, -6) }, true)
    // Sine peak sits ~3 dB above RMS; allow that plus smoothing slop.
    const allowedPeakDb = programDb + TUNING.windowDb + 3 + 2
    expect(linToDb(peak(out))).toBeLessThan(allowedPeakDb)
  })

  it('never exceeds the absolute ceiling', () => {
    const core = new LevelerCore(SR)
    run(core, 15, { left: sine(440, -12) })
    const out = run(core, 0.5, { left: sine(440, -3) }, true)
    expect(linToDb(peak(out))).toBeLessThan(TUNING.maxCeilingDb + 1)
  })
})

describe('video.volume compensation', () => {
  it('preserves the player slider: half volume in, half volume out', () => {
    const full = new LevelerCore(SR)
    full.setVideoVolume(1)
    run(full, 15, { left: sine(440, -33) })
    const outFull = run(full, 2, { left: sine(440, -33) }, true)

    const halved = new LevelerCore(SR)
    halved.setVideoVolume(0.5)
    // The element applies its volume before our tap: signal arrives 6 dB down.
    run(halved, 15, { left: sine(440, -39) })
    const outHalved = run(halved, 2, { left: sine(440, -39) }, true)

    // Compensation ⇒ same AGC decision ⇒ output tracks the slider (-6 dB).
    expect(rmsDb(outHalved) - rmsDb(outFull)).toBeGreaterThan(-7.5)
    expect(rmsDb(outHalved) - rmsDb(outFull)).toBeLessThan(-4.5)
  })
})

describe('speech-gated side ducking', () => {
  /** Stereo program: `midFreq` voice in the center, 6 kHz bed in the sides. */
  function sideLevelWithCenter(midFreq: number): number {
    const core = new LevelerCore(SR)
    const voice = sine(midFreq, -28)
    const bed = sine(6000, -28)
    const left = (t: number) => voice(t) + bed(t)
    const right = (t: number) => voice(t) - bed(t)
    run(core, 10, { left, right })
    const out = run(core, 2, { left, right }, true)
    // Recover the side signal: (L - R) / 2.
    const sideBufs: Float32Array[] = []
    for (let i = 0; i < out.length; i += 2) {
      const s = new Float32Array(out[i].length)
      for (let j = 0; j < s.length; j++) s[j] = (out[i][j] - out[i + 1][j]) / 2
      sideBufs.push(s)
    }
    return rmsDb(sideBufs)
  }

  it('ducks the stereo bed while center speech is present', () => {
    const withSpeech = sideLevelWithCenter(1000) // speech-band center
    const withRumble = sideLevelWithCenter(80) // non-speech center
    expect(withSpeech).toBeLessThan(withRumble - TUNING.duckDb * -1 + 2)
    expect(withSpeech).toBeLessThan(withRumble - 2.5)
  })

  it('detects speech-band center content', () => {
    const core = new LevelerCore(SR)
    const voice = sine(1000, -28)
    run(core, 3, { left: voice, right: voice })
    expect(core.speechDetected).toBe(true)
  })

  it('does not flag low-frequency center content as speech', () => {
    const core = new LevelerCore(SR)
    const rumble = sine(60, -28)
    run(core, 3, { left: rumble, right: rumble })
    expect(core.speechDetected).toBe(false)
  })
})

describe('plumbing', () => {
  it('bypass is bit-exact passthrough', () => {
    const core = new LevelerCore(SR)
    core.setBypass(true)
    const input = new Float32Array(BLOCK)
    for (let i = 0; i < BLOCK; i++) input[i] = Math.sin(i * 0.1) * 0.5
    const output = new Float32Array(BLOCK)
    core.process([input], [output])
    expect(Array.from(output)).toEqual(Array.from(input))
  })

  it('handles mono without crashing and produces signal', () => {
    const core = new LevelerCore(SR)
    const out = run(core, 2, { left: sine(440, -30) }, true)
    expect(rmsDb(out)).toBeGreaterThan(-60)
  })
})
