/**
 * Turns microphone audio into the 16-bit PCM pieces that the native
 * recorder takes, as the audio arrives: 16 kHz mono, or for a high-quality
 * recording the microphone's own rate and channels, interleaved (the native
 * side converts those). Nothing here keeps the whole recording in memory, so
 * a session can last for hours.
 */
export const CAPTURE_SAMPLE_RATE = 16000;
/** Half a second per piece: small enough for live text, few enough calls. */
export const CAPTURE_PIECE_SAMPLES = 8000;

/**
 * Samples in half a second of interleaved audio: whole frames, so a piece
 * never ends inside one. 24,000 frames (96 kB) at 48 kHz stereo.
 */
export function capturePieceSamples(sampleRate: number, channels: number) {
  return Math.max(1, Math.round(sampleRate / 2)) * channels;
}

/** Channels side by side, one frame after another. */
export function interleave(channels: Float32Array[]): Float32Array {
  if (channels.length === 1) return channels[0]!;
  const frames = Math.min(...channels.map((channel) => channel.length));
  const interleaved = new Float32Array(frames * channels.length);
  for (let frame = 0; frame < frames; frame++)
    for (let index = 0; index < channels.length; index++)
      interleaved[frame * channels.length + index] = channels[index]![frame]!;
  return interleaved;
}

/** Interleaved frames mixed down to one channel. */
export function mixToMono(block: Float32Array, channels: number): Float32Array {
  if (channels <= 1) return block;
  const mono = new Float32Array(Math.floor(block.length / channels));
  for (let frame = 0; frame < mono.length; frame++) {
    let sum = 0;
    for (let index = 0; index < channels; index++)
      sum += block[frame * channels + index] ?? 0;
    mono[frame] = sum / channels;
  }
  return mono;
}

/**
 * Brings a stream of blocks at any rate to 16 kHz. Going down, each output
 * sample is the average of the source samples it covers, which keeps high
 * frequencies from folding into the speech band.
 */
export class PcmResampler {
  private readonly step: number;
  private consumed = 0;
  private produced = 0;
  private sum = 0;
  private count = 0;

  constructor(readonly sourceRate: number) {
    if (
      !Number.isFinite(sourceRate) ||
      sourceRate < 8000 ||
      sourceRate > 192000
    )
      throw new RangeError(`Unsupported sample rate: ${sourceRate}`);
    this.step = sourceRate / CAPTURE_SAMPLE_RATE;
  }

  push(block: Float32Array): Float32Array {
    if (this.step === 1) return block;
    const output = new Float32Array(
      Math.ceil((block.length + 1) / this.step) + 1,
    );
    let written = 0;
    for (const raw of block) {
      const sample = Number.isFinite(raw) ? raw : 0;
      this.consumed += 1;
      if (this.step > 1) {
        this.sum += sample;
        this.count += 1;
        // The source sample that ends the current output sample.
        if (this.consumed >= (this.produced + 1) * this.step) {
          output[written++] = this.sum / this.count;
          this.produced += 1;
          this.sum = 0;
          this.count = 0;
        }
      } else {
        // A slower source: hold each sample for as long as it covers.
        while (this.produced * this.step < this.consumed) {
          output[written++] = sample;
          this.produced += 1;
        }
      }
    }
    return output.subarray(0, written);
  }
}

export function floatToPcm16(samples: Float32Array): Int16Array {
  const pcm = new Int16Array(samples.length);
  for (let index = 0; index < samples.length; index++) {
    const sample = Math.max(-1, Math.min(1, samples[index] || 0));
    pcm[index] = Math.round(sample * (sample < 0 ? 32768 : 32767));
  }
  return pcm;
}

/** Loudness of a block from 0 (silence) to 1 (full scale), for a level meter. */
export function pcmLevel(samples: Float32Array): number {
  if (!samples.length) return 0;
  let energy = 0;
  for (const sample of samples) energy += sample * sample || 0;
  return Math.min(1, Math.sqrt(energy / samples.length));
}

/** Groups samples into pieces of one size, ready to send. */
export class PcmBatcher {
  private piece: Int16Array;
  private filled = 0;

  constructor(private readonly size = CAPTURE_PIECE_SAMPLES) {
    this.piece = new Int16Array(size);
  }

  push(samples: Int16Array): Int16Array[] {
    const pieces: Int16Array[] = [];
    let offset = 0;
    while (offset < samples.length) {
      const count = Math.min(samples.length - offset, this.size - this.filled);
      this.piece.set(samples.subarray(offset, offset + count), this.filled);
      this.filled += count;
      offset += count;
      if (this.filled === this.size) {
        pieces.push(this.piece);
        this.piece = new Int16Array(this.size);
        this.filled = 0;
      }
    }
    return pieces;
  }

  /** What is left when the recording stops. */
  flush(): Int16Array | undefined {
    if (!this.filled) return undefined;
    const rest = this.piece.slice(0, this.filled);
    this.filled = 0;
    return rest;
  }
}

/** The bytes of a piece, little-endian as the native recorder expects. */
export function pcmBytes(piece: Int16Array): Uint8Array {
  const bytes = new Uint8Array(piece.length * 2);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < piece.length; index++)
    view.setInt16(index * 2, piece[index]!, true);
  return bytes;
}
