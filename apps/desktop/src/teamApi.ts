const API_BASE =
  ((globalThis as Record<string, unknown>).__SONOLECT_API_URL as string) ??
  "http://localhost:8080";

function authHeaders(token?: string): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (token) h["Authorization"] = `Bearer ${token}`;
  return h;
}

export type TeamRole = "owner" | "admin" | "member";

export interface TeamMember {
  userId: string;
  displayName: string;
  email: string;
  role: TeamRole;
  joinedAt: string;
}

export interface Team {
  id: string;
  name: string;
  createdAt: string;
  ownerId: string;
  members: TeamMember[];
}

export interface TeamInvite {
  id: string;
  teamId: string;
  email: string;
  role: TeamRole;
  expiresAt: string;
  accepted: boolean;
}

export async function fetchTeams(token?: string): Promise<Team[]> {
  const res = await fetch(`${API_BASE}/teams`, {
    headers: authHeaders(token),
  });
  if (!res.ok) throw new Error(`Failed to fetch teams: ${res.status}`);
  const data = await res.json();
  return data.items ?? data;
}

export async function createTeam(name: string, token?: string): Promise<Team> {
  const res = await fetch(`${API_BASE}/teams`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error(`Failed to create team: ${res.status}`);
  return res.json();
}

export async function fetchTeamMembers(
  teamId: string,
  token?: string,
): Promise<TeamMember[]> {
  const res = await fetch(`${API_BASE}/teams/${teamId}/members`, {
    headers: authHeaders(token),
  });
  if (!res.ok) throw new Error(`Failed to fetch members: ${res.status}`);
  const data = await res.json();
  return data.items ?? data;
}

export async function inviteTeamMember(
  teamId: string,
  email: string,
  role: TeamRole,
  token?: string,
): Promise<TeamInvite> {
  const res = await fetch(`${API_BASE}/teams/${teamId}/invites`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({ email, role }),
  });
  if (!res.ok) throw new Error(`Failed to invite member: ${res.status}`);
  return res.json();
}

export async function removeTeamMember(
  teamId: string,
  userId: string,
  token?: string,
): Promise<void> {
  const res = await fetch(`${API_BASE}/teams/${teamId}/members/${userId}`, {
    method: "DELETE",
    headers: authHeaders(token),
  });
  if (!res.ok) throw new Error(`Failed to remove member: ${res.status}`);
}

export async function updateMemberRole(
  teamId: string,
  userId: string,
  role: TeamRole,
  token?: string,
): Promise<TeamMember> {
  const res = await fetch(`${API_BASE}/teams/${teamId}/members/${userId}`, {
    method: "PATCH",
    headers: authHeaders(token),
    body: JSON.stringify({ role }),
  });
  if (!res.ok) throw new Error(`Failed to update role: ${res.status}`);
  return res.json();
}

export async function deleteTeam(
  teamId: string,
  token?: string,
): Promise<void> {
  const res = await fetch(`${API_BASE}/teams/${teamId}`, {
    method: "DELETE",
    headers: authHeaders(token),
  });
  if (!res.ok) throw new Error(`Failed to delete team: ${res.status}`);
}
