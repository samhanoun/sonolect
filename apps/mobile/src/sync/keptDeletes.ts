import {
  type Hlc,
  type LocalDelete,
  NOTE_ID_PATTERN,
  VAULT_ID_PATTERN,
  compareHlc,
  isHlc,
  toHlc,
} from "@sonolect/sync-core";

/**
 * Deletes made on this phone that no open vault holds yet, by vault: those
 * the engine had not uploaded when sync was turned off with the server copy
 * kept, or when the notes were cleared on this phone only, and those made
 * while the vault was not open yet (at launch, or a key that could not be
 * read). The next engine of the same vault takes them, so they still reach
 * the other devices. One AsyncStorage value, outside the sync state (which
 * is forgotten) and outside the notes (which are cleared); Erase all removes
 * it with every other 'sonolect.mobile.' key.
 */
export const SYNC_KEPT_DELETES_ITEM = "sonolect.mobile.sync.keptDeletes";

/** AsyncStorage's calls the kept deletes need. */
export interface KeptDeletesStorage {
  getItem(key: string): Promise<string | null | undefined>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

type Kept = Record<string, LocalDelete[]>;

const hlcOrNothing = (value: unknown): Hlc | undefined =>
  isHlc(value) ? toHlc(value) : undefined;

/** One kept delete, or null for anything that is not one. */
function parseDelete(value: unknown): LocalDelete | null {
  if (typeof value !== "object" || value === null) return null;
  const entry = value as Record<string, unknown>;
  if (typeof entry.id !== "string" || !NOTE_ID_PATTERN.test(entry.id))
    return null;
  const hlc = hlcOrNothing(entry.hlc);
  const deletedAt = hlcOrNothing(entry.deletedAt);
  const synced =
    typeof entry.synced === "object" && entry.synced !== null
      ? (entry.synced as Record<string, unknown>)
      : undefined;
  const syncedHlc = hlcOrNothing(synced?.hlc);
  return {
    id: entry.id,
    ...(hlc ? { hlc } : {}),
    ...(deletedAt ? { deletedAt } : {}),
    ...(syncedHlc
      ? {
          synced: {
            hlc: syncedHlc,
            ...(typeof synced?.fp === "string" ? { fp: synced.fp } : {}),
          },
        }
      : {}),
  };
}

async function read(storage: KeptDeletesStorage): Promise<Kept> {
  const raw = await storage.getItem(SYNC_KEPT_DELETES_ITEM);
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  const kept: Kept = {};
  if (typeof parsed !== "object" || parsed === null) return kept;
  for (const [vaultId, deletes] of Object.entries(parsed)) {
    if (!VAULT_ID_PATTERN.test(vaultId) || !Array.isArray(deletes)) continue;
    const valid = deletes
      .map(parseDelete)
      .filter((entry): entry is LocalDelete => entry !== null);
    if (valid.length > 0) kept[vaultId] = valid;
  }
  return kept;
}

async function write(storage: KeptDeletesStorage, kept: Kept): Promise<void> {
  if (Object.keys(kept).length === 0)
    await storage.removeItem(SYNC_KEPT_DELETES_ITEM);
  else await storage.setItem(SYNC_KEPT_DELETES_ITEM, JSON.stringify(kept));
}

/** The later of two deletes of one note: the later `deletedAt` wins. */
const later = (a: LocalDelete, b: LocalDelete): LocalDelete => {
  if (!a.deletedAt) return b;
  if (!b.deletedAt) return a;
  return compareHlc(b.deletedAt, a.deletedAt) > 0 ? b : a;
};

/**
 * The kept deletes over one AsyncStorage value. Calls run one at a time, in
 * order, so a delete kept while another call takes them is never lost.
 */
export function createKeptDeletes(storage: KeptDeletesStorage) {
  let queue: Promise<unknown> = Promise.resolve();
  const serialized = <T>(step: () => Promise<T>): Promise<T> => {
    const result = queue.then(step, step);
    queue = result.catch(() => undefined);
    return result;
  };
  return {
    /** Keeps deletes for this vault, with those already kept. */
    keep(vaultId: string, deletes: readonly LocalDelete[]): Promise<void> {
      return serialized(async () => {
        if (deletes.length === 0 || !VAULT_ID_PATTERN.test(vaultId)) return;
        const kept = await read(storage);
        const byId = new Map(
          (kept[vaultId] ?? []).map((entry) => [entry.id, entry]),
        );
        for (const entry of deletes) {
          const valid = parseDelete(entry);
          if (!valid) continue;
          const known = byId.get(valid.id);
          byId.set(valid.id, known ? later(known, valid) : valid);
        }
        kept[vaultId] = [...byId.values()];
        await write(storage, kept);
      });
    },
    /**
     * Hands this vault's kept deletes to `record` (the engine's
     * recordDeletes), and forgets them once it has them.
     */
    take(
      vaultId: string,
      record: (deletes: LocalDelete[]) => Promise<void>,
    ): Promise<void> {
      return serialized(async () => {
        const kept = await read(storage);
        const deletes = kept[vaultId];
        if (!deletes) return;
        await record(deletes);
        delete kept[vaultId];
        await write(storage, kept);
      });
    },
    /** The ids kept for a vault (for the tests). */
    async ids(vaultId: string): Promise<string[]> {
      return serialized(async () =>
        ((await read(storage))[vaultId] ?? []).map(({ id }) => id),
      );
    },
    /** Forgets every kept delete (Erase all). */
    clear(): Promise<void> {
      return serialized(() => storage.removeItem(SYNC_KEPT_DELETES_ITEM));
    },
  };
}

export type KeptDeletes = ReturnType<typeof createKeptDeletes>;
