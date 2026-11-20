/** The format a saved recording's audio is read in. */
export type CaptureAudioFormat = "ogg" | "wav";

/** What the player uses of an audio element. */
export type PlaybackMedia = {
  src: string;
  currentTime: number;
  readonly error: { readonly code: number } | null;
  canPlayType(type: string): string;
  play(): Promise<void>;
  pause(): void;
};

/** Where a recording's audio comes from, and how it is handed to the element. */
export type PlaybackSource = {
  read(id: string, format: CaptureAudioFormat): Promise<ArrayBuffer>;
  createUrl(blob: Blob): string;
  revokeUrl(url: string): void;
};

/**
 * Ogg Opus when this webview says it may play it: a compressed recording is
 * then sent as it is stored, about a tenth of its size as WAV. A recording
 * kept as WAV comes as WAV either way.
 */
export function playbackFormat(
  media: Pick<PlaybackMedia, "canPlayType">,
): CaptureAudioFormat {
  return media.canPlayType('audio/ogg; codecs="opus"') === "" ? "wav" : "ogg";
}

/** The type of the audio the device sent, from its first bytes. */
export function audioMimeType(bytes: ArrayBuffer): string {
  const tag = String.fromCharCode(
    ...new Uint8Array(bytes, 0, Math.min(4, bytes.byteLength)),
  );
  if (tag === "OggS") return "audio/ogg";
  if (tag === "RIFF") return "audio/wav";
  return "";
}

/**
 * Plays saved recordings in one audio element. The audio of a recording is
 * read once and kept until another one is played or the player is closed.
 */
export class CapturePlayback {
  private loaded:
    | { id: string; url: string; format: CaptureAudioFormat; type: string }
    | undefined;
  private request = 0;

  constructor(
    private readonly media: PlaybackMedia,
    private readonly source: PlaybackSource,
  ) {}

  /**
   * Plays a recording from a position, reading its audio first when another
   * one is loaded. `starting` runs just before playback starts. Resolves false
   * when a newer call, or close(), came first: nothing is changed then.
   */
  async play(
    id: string,
    fromMs: number,
    starting: () => void,
  ): Promise<boolean> {
    const current = (this.request += 1);
    const superseded = () => current !== this.request;
    try {
      if (this.loaded?.id !== id) {
        this.media.pause();
        if (!(await this.load(id, playbackFormat(this.media), superseded)))
          return false;
      }
      this.media.currentTime = Math.max(0, fromMs) / 1000;
      starting();
      try {
        await this.media.play();
      } catch (error) {
        // The webview could not play the Opus file after all: read the
        // recording again as WAV, once.
        const loaded = this.loaded;
        if (
          superseded() ||
          !this.media.error ||
          loaded?.format !== "ogg" ||
          loaded.type === "audio/wav"
        )
          throw error;
        if (!(await this.load(id, "wav", superseded))) return false;
        this.media.currentTime = Math.max(0, fromMs) / 1000;
        await this.media.play();
      }
      return !superseded();
    } catch (error) {
      if (superseded()) return false;
      throw error;
    }
  }

  pause() {
    this.media.pause();
  }

  /** Stops playback and lets go of the audio. A call still reading is dropped. */
  close() {
    this.request += 1;
    this.media.pause();
    this.unload();
  }

  /** Reads a recording's audio and hands it to the element, unless superseded. */
  private async load(
    id: string,
    format: CaptureAudioFormat,
    superseded: () => boolean,
  ) {
    const bytes = await this.source.read(id, format);
    if (superseded()) return false;
    const type = audioMimeType(bytes);
    this.unload();
    const url = this.source.createUrl(new Blob([bytes], { type }));
    this.loaded = { id, url, format, type };
    this.media.src = url;
    return true;
  }

  private unload() {
    if (this.loaded) this.source.revokeUrl(this.loaded.url);
    this.loaded = undefined;
  }
}
