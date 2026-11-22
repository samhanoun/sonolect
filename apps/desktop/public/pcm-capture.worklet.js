// Runs on the audio thread: hands microphone audio to the page in blocks of
// 1024 frames, one channel, or two interleaved for a high-quality recording
// (`processorOptions.channels`). Kept as a plain file because the app's
// content security policy only loads scripts from its own origin.
const FRAMES = 1024;

class PcmCapture extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.channels = options?.processorOptions?.channels === 2 ? 2 : 1;
    this.block = new Float32Array(FRAMES * this.channels);
    this.filled = 0;
  }

  process(inputs) {
    const input = inputs[0];
    const first = input && input[0];
    if (!first) return true;
    // A source with one channel is copied to both, as the node does.
    const second = this.channels === 2 ? input[1] || first : undefined;
    let offset = 0;
    while (offset < first.length) {
      const count = Math.min(first.length - offset, FRAMES - this.filled);
      if (second) {
        for (let index = 0; index < count; index++) {
          const frame = (this.filled + index) * 2;
          this.block[frame] = first[offset + index];
          this.block[frame + 1] = second[offset + index];
        }
      } else {
        this.block.set(first.subarray(offset, offset + count), this.filled);
      }
      this.filled += count;
      offset += count;
      if (this.filled === FRAMES) {
        // Posting copies the block, so it can be filled again.
        this.port.postMessage(this.block);
        this.filled = 0;
      }
    }
    return true;
  }
}

registerProcessor("pcm-capture", PcmCapture);
