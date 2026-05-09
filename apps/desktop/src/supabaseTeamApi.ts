import { supabase } from "./supabaseClient";
import type { TeamRole } from "./teamApi";

export async function fetchTeamsFromSupabase() {
  const { data, error } = await supabase
    .from("teams")
    .select(
      "*, team_members(user_id, role, joined_at, profiles(display_name, email))",
    );
  if (error) throw new Error(error.message);
  return (data ?? []).map((team: Record<string, unknown>) => ({
    id: team.id as string,
    name: team.name as string,
    createdAt: team.created_at as string,
    ownerId: team.owner_id as string,
    members: ((team.team_members as Array<Record<string, unknown>>) ?? []).map(
      (m: Record<string, unknown>) => {
        const profile = m.profiles as Record<string, unknown> | null;
        return {
          userId: m.user_id as string,
          displayName: (profile?.display_name as string) ?? "",
          email: (profile?.email as string) ?? "",
          role: m.role as TeamRole,
          joinedAt: m.joined_at as string,
        };
      },
    ),
  }));
}

export async function createTeamInSupabase(name: string) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const { data: team, error } = await supabase
    .from("teams")
    .insert({ name, owner_id: user.id })
    .select()
    .single();
  if (error) throw new Error(error.message);

  await supabase.from("team_members").insert({
    team_id: team.id,
    user_id: user.id,
    role: "owner",
  });

  return team;
}

export async function inviteMemberInSupabase(
  teamId: string,
  email: string,
  role: TeamRole,
) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const { data, error } = await supabase
    .from("team_invites")
    .insert({ team_id: teamId, email, role, invited_by: user.id })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data;
}

export async function removeMemberFromSupabase(teamId: string, userId: string) {
  const { error } = await supabase
    .from("team_members")
    .delete()
    .eq("team_id", teamId)
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
}

export async function updateMemberRoleInSupabase(
  teamId: string,
  userId: string,
  role: TeamRole,
) {
  const { error } = await supabase
    .from("team_members")
    .update({ role })
    .eq("team_id", teamId)
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
}

export async function deleteTeamFromSupabase(teamId: string) {
  const { error } = await supabase.from("teams").delete().eq("id", teamId);
  if (error) throw new Error(error.message);
}

export async function addSharedDictionaryEntry(
  teamId: string,
  spoken: string,
  replacement: string,
) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { error } = await supabase
    .from("shared_dictionaries")
    .insert({ team_id: teamId, spoken, replacement, created_by: user?.id });
  if (error) throw new Error(error.message);
}

export async function addSharedSnippet(
  teamId: string,
  trigger: string,
  body: string,
) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { error } = await supabase.from("shared_snippets").insert({
    team_id: teamId,
    trigger_text: trigger,
    body,
    created_by: user?.id,
  });
  if (error) throw new Error(error.message);
}
