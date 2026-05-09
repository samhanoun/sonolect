import type { DictionaryEntry, Snippet } from "./wisprWorkflow";
import type { Team, TeamMember, TeamRole } from "./teamApi";

export interface SharedDictionary {
  teamId: string;
  entries: DictionaryEntry[];
  updatedAt: string;
}

export interface SharedSnippetLibrary {
  teamId: string;
  snippets: Snippet[];
  updatedAt: string;
}

const ROLE_HIERARCHY: Record<TeamRole, number> = {
  owner: 3,
  admin: 2,
  member: 1,
};

export function hasPermission(
  member: TeamMember,
  requiredRole: TeamRole,
): boolean {
  return ROLE_HIERARCHY[member.role] >= ROLE_HIERARCHY[requiredRole];
}

export function canManageMembers(member: TeamMember): boolean {
  return hasPermission(member, "admin");
}

export function canDeleteTeam(member: TeamMember): boolean {
  return member.role === "owner";
}

export function canEditSharedResources(member: TeamMember): boolean {
  return hasPermission(member, "member");
}

export function mergeDictionaries(
  local: DictionaryEntry[],
  shared: DictionaryEntry[],
): DictionaryEntry[] {
  const merged = new Map<string, DictionaryEntry>();

  for (const entry of local) {
    merged.set(entry.spoken.toLowerCase(), entry);
  }

  for (const entry of shared) {
    const key = entry.spoken.toLowerCase();
    if (!merged.has(key)) {
      merged.set(key, entry);
    }
  }

  return [...merged.values()];
}

export function mergeSnippets(local: Snippet[], shared: Snippet[]): Snippet[] {
  const merged = new Map<string, Snippet>();

  for (const snippet of local) {
    merged.set(snippet.trigger.toLowerCase(), snippet);
  }

  for (const snippet of shared) {
    const key = snippet.trigger.toLowerCase();
    if (!merged.has(key)) {
      merged.set(key, snippet);
    }
  }

  return [...merged.values()];
}

export function findConflicts(
  local: DictionaryEntry[],
  shared: DictionaryEntry[],
): Array<{
  spoken: string;
  localReplacement: string;
  sharedReplacement: string;
}> {
  const sharedMap = new Map(
    shared.map((e) => [e.spoken.toLowerCase(), e.replacement]),
  );

  return local
    .filter((entry) => {
      const sharedVal = sharedMap.get(entry.spoken.toLowerCase());
      return sharedVal !== undefined && sharedVal !== entry.replacement;
    })
    .map((entry) => ({
      spoken: entry.spoken,
      localReplacement: entry.replacement,
      sharedReplacement: sharedMap.get(entry.spoken.toLowerCase())!,
    }));
}

export function resolveConflict(
  _local: DictionaryEntry,
  shared: DictionaryEntry,
  strategy: "keep-local" | "use-shared",
): DictionaryEntry {
  return strategy === "keep-local" ? _local : shared;
}

export function getTeamDisplayName(team: Team): string {
  return team.name;
}

export function getMemberCount(team: Team): number {
  return team.members.length;
}

export function sortMembersByRole(members: TeamMember[]): TeamMember[] {
  return [...members].sort(
    (a, b) => ROLE_HIERARCHY[b.role] - ROLE_HIERARCHY[a.role],
  );
}
