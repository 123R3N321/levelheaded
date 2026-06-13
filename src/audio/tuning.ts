/**
 * Every DSP knob in one place. These constants define the "normal" strength
 * preset; M3's gentle/aggressive presets will scale WINDOW_DB, AGC bounds,
 * and DUCK_DB. Tests import these so assertions track retuning automatically.
 */
export interface Tuning {
  /** Loudness the AGC steers program material toward (dBFS, RMS-based). */
  targetDb: number
  /** AGC gain bounds (dB). */
  maxBoostDb: number
  maxCutDb: number
  /** Below this short-term level the AGC and baseline freeze — never boost silence/room tone. */
  gateDb: number
  /** Seconds for loudness estimates: fast detector and slow program baseline. */
  shortTau: number
  baselineTau: number
  /** Seconds for the AGC gain to move ~63% toward its desired value. */
  agcTau: number

  /** Limiter: delay (s) giving the gain computer a head start on transients. */
  lookahead: number
  /**
   * Spike ceiling, relative to the rolling post-AGC program loudness: sounds
   * may exceed "what you've been hearing" by at most this much. This is the
   * relative-to-recent-playback dampening — the jump-scare killer.
   */
  windowDb: number
  /** Absolute ceiling regardless of program (dBFS) — clip safety. */
  maxCeilingDb: number
  /** Limiter gain smoothing (s): fast clamp-down, slower recovery. */
  limiterAttackTau: number
  limiterReleaseTau: number

  /** Mid/side: constant center (dialogue) boost and stereo-bed shave (dB). */
  midGainDb: number
  sideGainDb: number
  /** Extra side attenuation while speech is detected in the center (dB). */
  duckDb: number
  /** Speech detector: band (Hz), how dominant the band must be, minimum level. */
  speechBandLowHz: number
  speechBandHighHz: number
  speechRatio: number
  speechLevelDb: number
  /** Detector debounce: must hold this long to engage; lingers this long after (s). */
  speechAttack: number
  speechHold: number
  /** Duck gain smoothing (s). */
  duckTau: number

  /** video.volume below this is clamped for measurement (div-by-zero guard). */
  minVideoVolume: number
}

export const TUNING: Tuning = {
  targetDb: -25,
  maxBoostDb: 12,
  maxCutDb: -15,
  gateDb: -55,
  shortTau: 0.3,
  baselineTau: 3,
  agcTau: 3,

  lookahead: 0.015,
  windowDb: 6,
  maxCeilingDb: -3,
  limiterAttackTau: 0.003,
  limiterReleaseTau: 0.2,

  midGainDb: 3,
  sideGainDb: -3,
  duckDb: -5,
  speechBandLowHz: 300,
  speechBandHighHz: 3400,
  speechRatio: 0.5,
  speechLevelDb: -50,
  speechAttack: 0.03,
  speechHold: 0.25,
  duckTau: 0.05,

  minVideoVolume: 0.05,
}

export const dbToLin = (db: number): number => Math.pow(10, db / 20)
export const linToDb = (lin: number): number => 20 * Math.log10(Math.max(lin, 1e-9))
