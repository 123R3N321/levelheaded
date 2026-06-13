import { TUNING, type Tuning, dbToLin } from './tuning'

/**
 * The complete LevelHeaded DSP, free of Web Audio types so vitest can drive
 * it sample-by-sample. The worklet adapter (leveler-worklet.ts) is a thin
 * shell around this class.
 *
 * Signal flow per frame:
 *
 *   in (L,R) ──► loudness measurement (÷ video.volume, gated)
 *            ──► mid/side: mid boost, side shave, speech-gated side duck
 *            ──► AGC gain (slow ride toward target)
 *            ──► lookahead limiter: ceiling = rolling post-AGC loudness + window
 *            ──► out (delayed by `lookahead`, gain applied pre-delay-exit)
 *
 * The limiter ceiling rides the *recent program* loudness, so a "spike" is
 * defined relative to playback continuity, not an absolute level — a bang
 * after a whisper passage clamps far lower than the same bang mid-battle.
 */
export class LevelerCore {
  private readonly t: Tuning
  private readonly sr: number

  private videoVolume = 1
  private bypass = false

  // One-pole coefficients (per-sample).
  private readonly shortCoef: number
  private readonly baseCoef: number
  private readonly agcCoef: number
  private readonly limAttCoef: number
  private readonly limRelCoef: number
  private readonly duckCoef: number
  private readonly hpCoef: number
  private readonly lpCoef: number

  // Loudness state, volume-compensated. The fast detector lives in the power
  // domain (instant rise is what a detector wants); the program baseline is
  // tracked in dB so a brief +26 dB burst nudges it by fractions of a dB
  // instead of dragging it up within milliseconds — the baseline must
  // represent playback continuity, not the spike we're about to clamp.
  private shortPow = dbToLin(TUNING.targetDb) ** 2
  private baselineDb = TUNING.targetDb

  // AGC state.
  private agcDb = 0

  // Speech detector state.
  private hpState = 0
  private lpBandState = 0
  private bandPow = 0
  private midPow = 0
  private speechOnCount = 0
  private speechHoldCount = 0
  private speechActive = false
  private duckLin = 1

  // Limiter state.
  private env = 0
  private limGain = 1
  private readonly delaySamples: number
  private delayL: Float32Array
  private delayR: Float32Array
  private delayIdx = 0

  constructor(sampleRate: number, tuning: Tuning = TUNING) {
    this.t = tuning
    this.sr = sampleRate
    const coef = (tau: number) => Math.exp(-1 / (tau * sampleRate))
    this.shortCoef = coef(tuning.shortTau)
    this.baseCoef = coef(tuning.baselineTau)
    this.agcCoef = coef(tuning.agcTau)
    this.limAttCoef = coef(tuning.limiterAttackTau)
    this.limRelCoef = coef(tuning.limiterReleaseTau)
    this.duckCoef = coef(tuning.duckTau)
    // One-pole filter coefficients for the crude speech bandpass.
    this.hpCoef = 1 - Math.exp((-2 * Math.PI * tuning.speechBandLowHz) / sampleRate)
    this.lpCoef = 1 - Math.exp((-2 * Math.PI * tuning.speechBandHighHz) / sampleRate)
    this.delaySamples = Math.max(1, Math.round(tuning.lookahead * sampleRate))
    this.delayL = new Float32Array(this.delaySamples)
    this.delayR = new Float32Array(this.delaySamples)
  }

  setVideoVolume(v: number): void {
    this.videoVolume = Math.max(this.t.minVideoVolume, v)
  }

  setBypass(b: boolean): void {
    this.bypass = b
  }

  /** Exposed for tests and (later) the popup meter. */
  get agcGainDb(): number {
    return this.agcDb
  }
  get limiterGainDb(): number {
    return 20 * Math.log10(Math.max(this.limGain, 1e-9))
  }
  get speechDetected(): boolean {
    return this.speechActive
  }

  /**
   * Process one block. `input`/`output` are arrays of channel buffers of
   * equal length. Mono is processed as mid-only; channels beyond the first
   * two get the master (AGC × limiter) gain but no mid/side treatment.
   */
  process(input: Float32Array[], output: Float32Array[]): void {
    const channels = Math.min(input.length, output.length)
    if (channels === 0) return
    const n = input[0].length

    if (this.bypass) {
      for (let ch = 0; ch < channels; ch++) output[ch].set(input[ch])
      return
    }

    const t = this.t
    const stereo = channels >= 2
    const inL = input[0]
    const inR = stereo ? input[1] : input[0]
    const midGain = dbToLin(t.midGainDb)
    const sideGain = dbToLin(t.sideGainDb)
    const duckTarget = dbToLin(t.duckDb)
    const speechAttackSamples = t.speechAttack * this.sr
    const speechHoldSamples = t.speechHold * this.sr
    const eps = 1e-12

    for (let i = 0; i < n; i++) {
      const L = inL[i]
      const R = inR[i]

      // ---- Measurement: volume-compensated mono power -------------------
      // Dividing by video.volume makes the AGC neutral to the player's own
      // slider — it levels the content, the user keeps their knob.
      const mono = (L + R) * 0.5
      const meas = mono / this.videoVolume
      const p = meas * meas
      this.shortPow = this.shortCoef * this.shortPow + (1 - this.shortCoef) * p
      const shortDb = 10 * Math.log10(this.shortPow + eps)
      const gated = shortDb < t.gateDb

      // ---- Baseline + AGC: slow ride toward target, frozen below gate ----
      if (!gated) {
        this.baselineDb += (1 - this.baseCoef) * (shortDb - this.baselineDb)
        const desired = Math.min(
          t.maxBoostDb,
          Math.max(t.maxCutDb, t.targetDb - this.baselineDb),
        )
        this.agcDb += (1 - this.agcCoef) * (desired - this.agcDb)
      }
      const agcLin = dbToLin(this.agcDb)

      // ---- Speech detection on the (compensated) mid channel ------------
      this.hpState += this.hpCoef * (meas - this.hpState)
      const hp = meas - this.hpState // one-pole highpass @ band low edge
      this.lpBandState += this.lpCoef * (hp - this.lpBandState) // lowpass @ band high edge
      const band = this.lpBandState
      this.bandPow = this.duckCoef * this.bandPow + (1 - this.duckCoef) * band * band
      this.midPow = this.duckCoef * this.midPow + (1 - this.duckCoef) * p
      const loudEnough = this.midPow > dbToLin(t.speechLevelDb) ** 2
      const bandDominant = this.bandPow / (this.midPow + eps) > t.speechRatio
      if (loudEnough && bandDominant) {
        this.speechOnCount++
        if (this.speechOnCount >= speechAttackSamples) {
          this.speechActive = true
          this.speechHoldCount = speechHoldSamples
        }
      } else {
        this.speechOnCount = 0
        if (this.speechActive && --this.speechHoldCount <= 0) this.speechActive = false
      }
      const duckGoal = this.speechActive && stereo ? duckTarget : 1
      this.duckLin = this.duckCoef * this.duckLin + (1 - this.duckCoef) * duckGoal

      // ---- Mid/side + AGC ------------------------------------------------
      const mid = (L + R) * 0.5 * midGain
      const side = stereo ? (L - R) * 0.5 * sideGain * this.duckLin : 0
      const procL = (mid + side) * agcLin
      const procR = (mid - side) * agcLin

      // ---- Lookahead limiter, ceiling relative to recent program ---------
      // Post-AGC rolling loudness + window: "louder than what you've been
      // hearing by more than windowDb" is what gets clamped.
      const ceilingDb = Math.min(this.baselineDb + this.agcDb + t.windowDb, t.maxCeilingDb)
      const ceilLin = dbToLin(ceilingDb)
      const peak = Math.max(Math.abs(procL), Math.abs(procR))
      this.env = Math.max(peak, this.env * this.limRelCoef)
      const wanted = this.env > ceilLin ? ceilLin / this.env : 1
      const smoothCoef = wanted < this.limGain ? this.limAttCoef : this.limRelCoef
      this.limGain = smoothCoef * this.limGain + (1 - smoothCoef) * wanted

      // Delay line: gain (computed from the present) applies to audio from
      // `lookahead` ago — the clamp lands before the transient reaches ears.
      const dL = this.delayL[this.delayIdx]
      const dR = this.delayR[this.delayIdx]
      this.delayL[this.delayIdx] = procL
      this.delayR[this.delayIdx] = procR
      this.delayIdx = (this.delayIdx + 1) % this.delaySamples

      output[0][i] = dL * this.limGain
      if (stereo) output[1][i] = dR * this.limGain
      const masterGain = agcLin * this.limGain
      for (let ch = 2; ch < channels; ch++) {
        output[ch][i] = input[ch][i] * masterGain
      }
    }
  }
}
