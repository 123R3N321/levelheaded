import { LevelerCore } from './leveler-core'

/**
 * Thin AudioWorklet shell around LevelerCore. Built as a standalone file
 * (vite.worklet.config.ts → public/leveler-worklet.js) because worklet
 * modules load via audioWorklet.addModule(url), outside the normal bundle
 * graph. All logic and tuning live in leveler-core.ts / tuning.ts.
 */
class LevelerProcessor extends AudioWorkletProcessor {
  private core = new LevelerCore(sampleRate)

  constructor() {
    super()
    this.port.onmessage = (e: MessageEvent) => {
      const msg = e.data as { type: string; value: number | boolean }
      if (msg.type === 'volume') this.core.setVideoVolume(msg.value as number)
      if (msg.type === 'bypass') this.core.setBypass(msg.value as boolean)
    }
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const input = inputs[0]
    const output = outputs[0]
    if (input && output && input.length > 0) {
      this.core.process(input, output)
    }
    return true
  }
}

registerProcessor('levelheaded-leveler', LevelerProcessor)
