/** PCM adapter for the embedded Whisper engine (16 kHz, mono, signed 16-bit WAV). */
export function encodeMonoWav(channels: Float32Array[], sampleRate: number): Uint8Array {
  const frames = channels[0]?.length ?? 0;
  if (!frames || !Number.isFinite(sampleRate) || sampleRate < 8000 || sampleRate > 192000 ||
      channels.some(channel => channel.length !== frames)) throw new Error("Invalid audio format.");
  if (frames / sampleRate > 180) throw new Error("Recordings are limited to three minutes.");
  const count = Math.max(1, Math.round(frames * 16000 / sampleRate));
  const bytes = new Uint8Array(44 + count * 2);
  const view = new DataView(bytes.buffer);
  const ascii = (offset: number, text: string) => [...text].forEach((char, i) => view.setUint8(offset + i, char.charCodeAt(0)));
  ascii(0, "RIFF"); view.setUint32(4, bytes.length - 8, true);
  ascii(8, "WAVE"); ascii(12, "fmt "); view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, 16000, true); view.setUint32(28, 32000, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  ascii(36, "data"); view.setUint32(40, count * 2, true);
  // Average each source interval while downsampling to reduce aliasing.
  for (let i = 0; i < count; i++) {
    const start = Math.min(frames - 1, Math.floor(i * sampleRate / 16000));
    const end = Math.max(start + 1, Math.min(frames, Math.floor((i + 1) * sampleRate / 16000)));
    let total = 0;
    for (const channel of channels) {
      for (let frame = start; frame < end; frame++) {
        const value = channel[frame]!;
        if (!Number.isFinite(value)) throw new Error("Audio contains invalid samples.");
        total += value;
      }
    }
    const sample = Math.max(-1, Math.min(1, total / ((end - start) * channels.length)));
    view.setInt16(44 + i * 2, Math.round(sample * (sample < 0 ? 32768 : 32767)), true);
  }
  return bytes;
}

export async function prepareLocalAudio(audio: Blob): Promise<Uint8Array> {
  const context = new AudioContext();
  try {
    const decoded = await context.decodeAudioData(await audio.arrayBuffer());
    return encodeMonoWav(Array.from({ length: decoded.numberOfChannels }, (_, index) => decoded.getChannelData(index)), decoded.sampleRate);
  } finally {
    await context.close();
  }
}
