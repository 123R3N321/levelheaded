// AudioWorkletGlobalScope declarations — TypeScript's dom lib only types the
// main-thread side (AudioWorkletNode), not the processor side.
declare class AudioWorkletProcessor {
  readonly port: MessagePort
}

declare function registerProcessor(
  name: string,
  ctor: new () => AudioWorkletProcessor & {
    process(
      inputs: Float32Array[][],
      outputs: Float32Array[][],
      parameters: Record<string, Float32Array>,
    ): boolean
  },
): void

/** Sample rate of the AudioContext this worklet runs in. */
declare const sampleRate: number
