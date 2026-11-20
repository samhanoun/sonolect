// Runs on the audio thread: hands microphone audio to the page in blocks of
// 1024 mono samples. Kept as a plain file because the app's content security
// policy only loads scripts from its own origin.
class PcmCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.block = new Float32Array(1024);
    this.filled = 0;
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (!channel) return true;
    let offset = 0;
    while (offset < channel.length) {
      const count = Math.min(
        channel.length - offset,
        this.block.length - this.filled,
      );
      this.block.set(channel.subarray(offset, offset + count), this.filled);
      this.filled += count;
      offset += count;
      if (this.filled === this.block.length) {
        // Posting copies the block, so it can be filled again.
        this.port.postMessage(this.block);
        this.filled = 0;
      }
    }
    return true;
  }
}

registerProcessor("pcm-capture", PcmCapture);
