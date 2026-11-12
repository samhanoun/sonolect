/**
 * Keeps the screen on for the dictation that holds it: a screen that turns
 * off sends the app to the background, where the microphone stops. Pure:
 * store.ts passes in expo-keep-awake's calls.
 */

export interface KeepAwakeCalls {
  activate(): Promise<void>;
  deactivate(): Promise<void>;
}

export interface KeepAwake {
  /** Dictation `id` keeps the screen on; a later hold takes over. */
  hold(id: string): void;
  /**
   * Lets the screen turn off again, only when dictation `id` holds it. With
   * no id, whichever dictation holds it.
   */
  release(id?: string): void;
}

export function createKeepAwake(calls: KeepAwakeCalls): KeepAwake {
  let owner: string | null = null;
  // The calls are queued so a release never lands before the activation it
  // follows, and a failed call never stops the next one.
  let queue: Promise<void> = Promise.resolve();
  const enqueue = (run: () => Promise<void>) => {
    queue = queue.then(run).catch(() => undefined);
  };

  return {
    hold(id) {
      const held = owner !== null;
      owner = id;
      if (!held) enqueue(() => calls.activate());
    },
    release(id) {
      if (owner === null || (id !== undefined && id !== owner)) return;
      owner = null;
      enqueue(() => calls.deactivate());
    },
  };
}
