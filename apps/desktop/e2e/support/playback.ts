import type { Page } from "@playwright/test";

/** What the page played, as `watchPlayback` records it. */
export type Played = {
  /** The type of every blob the page turned into a URL, in order. */
  types: string[];
  /** How many times the page asked an audio element to play. */
  plays: number;
  /** Every position, in seconds, an audio element reported while playing. */
  times: number[];
};

/** Records what the page plays from now on (see `played`). */
export async function watchPlayback(page: Page) {
  await page.addInitScript(() => {
    const watched: Played = { types: [], plays: 0, times: [] };
    const create = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (object: Blob | MediaSource) => {
      if (object instanceof Blob) watched.types.push(object.type);
      return create(object);
    };
    const elements = new WeakSet<HTMLMediaElement>();
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      watched.plays += 1;
      if (!elements.has(this)) {
        elements.add(this);
        this.addEventListener("timeupdate", () =>
          watched.times.push(this.currentTime),
        );
      }
      return play.call(this);
    };
    Object.assign(window, { __sonolectE2ePlayed: watched });
  });
}

export function played(page: Page) {
  return page.evaluate(
    () =>
      (window as typeof window & { __sonolectE2ePlayed: Played })
        .__sonolectE2ePlayed,
  );
}
