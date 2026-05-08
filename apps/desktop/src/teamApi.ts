import type { Team, TeamInvite, TeamMember } from "@sonolect/types";
import type { DictionaryEntry, Snippet } from "./wisprWorkflow";

const headers = (token: string | undefined) => ({
  "Content-Type": "application/json",
  ...(token ? { Authorization: `Bearer ${token}` } : {}),
});

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${body}`);
  }
  return (await res.json()) as T;
}

export async function fetchTeams(
  apiUrl: string | undefined,
  token: string | undefined,
): Promise<Team[]> {
  if (!apiUrl) return [];
  const res = await fetch(`${apiUrl}/teams`, { headers: headers(token) });
  return jsonOrThrow<Team[]>(res);
}

export async function fetchTeamDetail(
  apiUrl: string | undefined,
  token: string | undefined,
  teamId: string,
): Promise<{ team: Team; members: TeamMember[]; invites: TeamInvite[] }> {
  if (!apiUrl) throw new Error("API URL not configured");
  const res = await fetch(`${apiUrl}/teams/${teamId}`, {
    headers: headers(token),
  });
  return jsonOrThrow<{
    team: Team;
    members: TeamMember[];
    invites: TeamInvite[];
  }>(res);
}

export async function createTeam(
  apiUrl: string | undefined,
  token: string | undefined,
  name: string,
): Promise<Team> {
  if (!apiUrl) throw new Error("API URL not configured");
  const res = await fetch(`${apiUrl}/teams`, {
    method: "POST",
    headers: headers(token),
    body: JSON.stringify({ name }),
  });
  return jsonOrThrow<Team>(res);
}

export async function inviteToTeam(
  apiUrl: string | undefined,
  token: string | undefined,
  teamId: string,
  email: string,
  role: "admin" | "member",
): Promise<TeamInvite> {
  if (!apiUrl) throw new Error("API URL not configured");
  const res = await fetch(`${apiUrl}/teams/${teamId}/invite`, {
    method: "POST",
    headers: headers(token),
    body: JSON.stringify({ email, role }),
  });
  return jsonOrThrow<TeamInvite>(res);
}

export async function joinTeam(
  apiUrl: string | undefined,
  token: string | undefined,
  teamId: string,
  inviteId: string,
): Promise<TeamMember> {
  if (!apiUrl) throw new Error("API URL not configured");
  const res = await fetch(`${apiUrl}/teams/${teamId}/join`, {
    method: "POST",
    headers: headers(token),
    body: JSON.stringify({ inviteId }),
  });
  return jsonOrThrow<TeamMember>(res);
}

export async function removeMember(
  apiUrl: string | undefined,
  token: string | undefined,
  teamId: string,
  userId: string,
): Promise<void> {
  if (!apiUrl) throw new Error("API URL not configured");
  const res = await fetch(`${apiUrl}/teams/${teamId}/members/${userId}`, {
    method: "DELETE",
    headers: headers(token),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${body}`);
  }
}

export async function fetchSharedDictionary(
  apiUrl: string | undefined,
  token: string | undefined,
  teamId: string,
): Promise<DictionaryEntry[]> {
  if (!apiUrl) return [];
  const res = await fetch(`${apiUrl}/teams/${teamId}/shared/dictionary`, {
    headers: headers(token),
  });
  return jsonOrThrow<DictionaryEntry[]>(res);
}

export async function updateSharedDictionary(
  apiUrl: string | undefined,
  token: string | undefined,
  teamId: string,
  entries: DictionaryEntry[],
): Promise<void> {
  if (!apiUrl) throw new Error("API URL not configured");
  const res = await fetch(`${apiUrl}/teams/${teamId}/shared/dictionary`, {
    method: "PUT",
    headers: headers(token),
    body: JSON.stringify(entries),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${body}`);
  }
}

export async function fetchSharedSnippets(
  apiUrl: string | undefined,
  token: string | undefined,
  teamId: string,
): Promise<Snippet[]> {
  if (!apiUrl) return [];
  const res = await fetch(`${apiUrl}/teams/${teamId}/shared/snippets`, {
    headers: headers(token),
  });
  return jsonOrThrow<Snippet[]>(res);
}

export async function updateSharedSnippets(
  apiUrl: string | undefined,
  token: string | undefined,
  teamId: string,
  snippets: Snippet[],
): Promise<void> {
  if (!apiUrl) throw new Error("API URL not configured");
  const res = await fetch(`${apiUrl}/teams/${teamId}/shared/snippets`, {
    method: "PUT",
    headers: headers(token),
    body: JSON.stringify(snippets),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${body}`);
  }
}
