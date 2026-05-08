import type {
  Team,
  TeamMember,
  TeamInvite,
  SharedResource,
  TeamSyncManifest,
} from "@sonolect/types";
import type { DictionaryEntry, Snippet } from "./wisprWorkflow";
import { createId } from "./wisprWorkflow";

/* ─── State ─── */

export type TeamState = {
  currentTeam: Team | null;
  members: TeamMember[];
  sharedDictionary: DictionaryEntry[];
  sharedSnippets: Snippet[];
  pendingInvites: TeamInvite[];
};

/* ─── Team CRUD ─── */

export function createTeam(name: string, ownerId: string): Team {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Team name must not be empty");
  return {
    id: createId("team"),
    name: trimmed,
    slug: trimmed
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, ""),
    ownerId,
    createdAt: new Date().toISOString(),
  };
}

/* ─── Invites ─── */

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export function createTeamInvite(
  teamId: string,
  email: string,
  role: "admin" | "member",
  invitedBy: string,
): TeamInvite {
  const now = new Date();
  return {
    id: createId("inv"),
    teamId,
    email: email.trim().toLowerCase(),
    role,
    invitedBy,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + INVITE_TTL_MS).toISOString(),
    status: "pending",
  };
}

export function isInviteExpired(invite: TeamInvite): boolean {
  return (
    invite.status === "expired" || Date.now() > Date.parse(invite.expiresAt)
  );
}

/* ─── Members ─── */

export function addTeamMember(
  members: TeamMember[],
  userId: string,
  teamId: string,
  role: TeamMember["role"],
): TeamMember[] {
  if (members.some((m) => m.userId === userId && m.teamId === teamId)) {
    return members;
  }
  return [
    ...members,
    { userId, teamId, role, joinedAt: new Date().toISOString() },
  ];
}

export function removeTeamMember(
  members: TeamMember[],
  userId: string,
): TeamMember[] {
  return members.filter((m) => m.userId !== userId);
}

/* ─── Permissions ─── */

export type TeamAction = "read" | "write" | "admin" | "invite";

const ROLE_PERMISSIONS: Record<TeamMember["role"], Set<TeamAction>> = {
  owner: new Set(["read", "write", "admin", "invite"]),
  admin: new Set(["read", "write", "invite"]),
  member: new Set(["read", "write"]),
};

export function hasPermission(member: TeamMember, action: TeamAction): boolean {
  const allowed = ROLE_PERMISSIONS[member.role];
  return allowed !== undefined && allowed.has(action);
}

/* ─── Merge helpers ─── */

export function mergeSharedDictionary(
  local: DictionaryEntry[],
  shared: DictionaryEntry[],
): DictionaryEntry[] {
  const merged = new Map<string, DictionaryEntry>();

  // Local entries first
  for (const entry of local) {
    merged.set(entry.spoken.toLowerCase(), entry);
  }

  // Shared entries overwrite on conflict (shared wins)
  for (const entry of shared) {
    merged.set(entry.spoken.toLowerCase(), entry);
  }

  return [...merged.values()];
}

export function mergeSharedSnippets(
  local: Snippet[],
  shared: Snippet[],
): Snippet[] {
  const merged = new Map<string, Snippet>();

  // Local entries first
  for (const entry of local) {
    merged.set(entry.trigger.toLowerCase(), entry);
  }

  // Shared entries overwrite on conflict (shared wins)
  for (const entry of shared) {
    merged.set(entry.trigger.toLowerCase(), entry);
  }

  return [...merged.values()];
}

/* ─── Conflict resolution ─── */

export function resolveConflict(
  local: SharedResource,
  remote: SharedResource,
): SharedResource {
  // Higher version wins; on equal version, last-write-wins by timestamp
  if (remote.version > local.version) return remote;
  if (local.version > remote.version) return local;
  return Date.parse(remote.updatedAt) >= Date.parse(local.updatedAt)
    ? remote
    : local;
}

/* ─── Sync payload ─── */

export function buildTeamSyncPayload(state: TeamState): TeamSyncManifest {
  if (!state.currentTeam) {
    throw new Error("No current team to build sync payload for");
  }

  const resources: SharedResource[] = [];
  const now = new Date().toISOString();
  const teamId = state.currentTeam.id;

  for (const entry of state.sharedDictionary) {
    resources.push({
      id: entry.id,
      teamId,
      resourceType: "dictionary",
      data: entry,
      updatedBy: state.currentTeam.ownerId,
      updatedAt: now,
      version: 1,
    });
  }

  for (const snippet of state.sharedSnippets) {
    resources.push({
      id: snippet.id,
      teamId,
      resourceType: "snippet",
      data: snippet,
      updatedBy: state.currentTeam.ownerId,
      updatedAt: now,
      version: 1,
    });
  }

  return { teamId, resources, lastSyncAt: now };
}
