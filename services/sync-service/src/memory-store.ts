import {
  type ChangesPage,
  type CreateOutcome,
  type Quotas,
  type StoreWriteResult,
  type StoredRecord,
  type VaultMeta,
  type VaultStore,
  VaultGoneError,
  type WriteInput,
  cutPage,
  decideWrite,
} from "./store.js";

interface MemoryVault extends VaultMeta {
  recordsById: Map<string, StoredRecord>;
}

const metaOf = (vault: MemoryVault): VaultMeta => ({
  verifier: vault.verifier,
  epoch: vault.epoch,
  head: vault.head,
  records: vault.records,
  tombstones: vault.tombstones,
  bytes: vault.bytes,
  purgedSeq: vault.purgedSeq,
  purgedAt: vault.purgedAt,
  deletedAt: vault.deletedAt,
});

/**
 * Vaults in process memory, for tests and local development. Everything is
 * lost on restart, so production refuses it.
 */
export class MemoryStore implements VaultStore {
  readonly kind = "memory";
  private readonly vaults = new Map<string, MemoryVault>();

  async createVault(
    vaultId: string,
    verifier: string,
    epoch: string,
    now: number,
  ): Promise<CreateOutcome> {
    const existing = this.vaults.get(vaultId);
    if (existing) {
      if (existing.verifier !== verifier) return { outcome: "mismatch" };
      if (existing.deletedAt !== undefined) return { outcome: "deleted" };
      return { outcome: "exists", epoch: existing.epoch };
    }
    this.vaults.set(vaultId, {
      verifier,
      epoch,
      head: 0,
      records: 0,
      tombstones: 0,
      bytes: 0,
      purgedSeq: 0,
      purgedAt: now,
      recordsById: new Map(),
    });
    return { outcome: "created", epoch };
  }

  async getVault(vaultId: string): Promise<VaultMeta | undefined> {
    const vault = this.vaults.get(vaultId);
    return vault && metaOf(vault);
  }

  async changes(
    vaultId: string,
    since: number,
    limit: number,
    maxBytes: number,
  ): Promise<ChangesPage> {
    const vault = this.vaults.get(vaultId);
    if (!vault) return { records: [], hasMore: false };
    const newer = [...vault.recordsById.values()]
      .filter((record) => record.seq > since)
      .sort((a, b) => a.seq - b.seq);
    return cutPage(newer, limit, maxBytes);
  }

  async write(
    vaultId: string,
    writes: readonly WriteInput[],
    quotas: Quotas,
    now: number,
  ): Promise<StoreWriteResult[]> {
    const vault = this.vaults.get(vaultId);
    if (!vault || vault.deletedAt !== undefined) throw new VaultGoneError();
    const counters = {
      head: vault.head,
      records: vault.records,
      tombstones: vault.tombstones,
      bytes: vault.bytes,
    };
    const results: StoreWriteResult[] = [];
    for (const write of writes) {
      const { result, record } = decideWrite(
        write,
        vault.recordsById.get(write.rid),
        counters,
        quotas,
        now,
      );
      results.push(result);
      if (record) vault.recordsById.set(record.rid, record);
    }
    vault.head = counters.head;
    vault.records = counters.records;
    vault.tombstones = counters.tombstones;
    vault.bytes = counters.bytes;
    return results;
  }

  async deleteVault(vaultId: string, now: number): Promise<void> {
    const vault = this.vaults.get(vaultId);
    if (!vault) return;
    vault.recordsById.clear();
    vault.records = 0;
    vault.tombstones = 0;
    vault.bytes = 0;
    vault.deletedAt ??= now;
  }

  async purge(
    vaultId: string,
    now: number,
    ttlMs: number,
    intervalMs: number,
  ): Promise<number> {
    const vault = this.vaults.get(vaultId);
    if (!vault || vault.deletedAt !== undefined) return 0;
    if (now - vault.purgedAt < intervalMs) return 0;
    vault.purgedAt = now;
    const cutoff = now - ttlMs;
    let purged = 0;
    for (const [rid, record] of vault.recordsById) {
      if (!record.deleted || record.updatedAt >= cutoff) continue;
      vault.recordsById.delete(rid);
      vault.records -= 1;
      vault.tombstones -= 1;
      vault.bytes -= record.size;
      vault.purgedSeq = Math.max(vault.purgedSeq, record.seq);
      purged += 1;
    }
    return purged;
  }

  async close(): Promise<void> {}

  /** Tests only: how many vaults the store holds, deleted ones included. */
  get size(): number {
    return this.vaults.size;
  }
}
