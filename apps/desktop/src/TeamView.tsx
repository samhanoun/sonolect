import React, { useCallback, useEffect, useState } from "react";
import type { Team, TeamMember, TeamRole } from "./teamApi";
import {
  fetchTeams,
  createTeam,
  fetchTeamMembers,
  inviteTeamMember,
  removeTeamMember,
  updateMemberRole,
  deleteTeam,
} from "./teamApi";
import {
  canManageMembers,
  canDeleteTeam,
  sortMembersByRole,
} from "./teamCollaboration";

export interface TeamViewProps {
  authToken?: string | undefined;
  currentUserId: string;
  onError?: (error: string) => void;
}

export function TeamView({
  authToken,
  currentUserId,
  onError,
}: TeamViewProps): React.ReactElement {
  const [teams, setTeams] = useState<Team[]>([]);
  const [selectedTeam, setSelectedTeam] = useState<Team | null>(null);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(false);
  const [newTeamName, setNewTeamName] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<TeamRole>("member");

  const loadTeams = useCallback(async () => {
    setLoading(true);
    try {
      const result = await fetchTeams(authToken);
      setTeams(result);
    } catch (err) {
      onError?.(err instanceof Error ? err.message : "Failed to load teams");
    } finally {
      setLoading(false);
    }
  }, [authToken, onError]);

  useEffect(() => {
    loadTeams();
  }, [loadTeams]);

  const loadMembers = useCallback(
    async (teamId: string) => {
      try {
        const result = await fetchTeamMembers(teamId, authToken);
        setMembers(sortMembersByRole(result));
      } catch (err) {
        onError?.(
          err instanceof Error ? err.message : "Failed to load members",
        );
      }
    },
    [authToken, onError],
  );

  const handleSelectTeam = useCallback(
    (team: Team) => {
      setSelectedTeam(team);
      loadMembers(team.id);
    },
    [loadMembers],
  );

  const handleCreateTeam = useCallback(async () => {
    if (!newTeamName.trim()) return;
    try {
      const team = await createTeam(newTeamName.trim(), authToken);
      setTeams((prev) => [...prev, team]);
      setNewTeamName("");
      handleSelectTeam(team);
    } catch (err) {
      onError?.(err instanceof Error ? err.message : "Failed to create team");
    }
  }, [newTeamName, authToken, onError, handleSelectTeam]);

  const handleInvite = useCallback(async () => {
    if (!selectedTeam || !inviteEmail.trim()) return;
    try {
      await inviteTeamMember(
        selectedTeam.id,
        inviteEmail.trim(),
        inviteRole,
        authToken,
      );
      setInviteEmail("");
      loadMembers(selectedTeam.id);
    } catch (err) {
      onError?.(err instanceof Error ? err.message : "Failed to invite member");
    }
  }, [selectedTeam, inviteEmail, inviteRole, authToken, onError, loadMembers]);

  const handleRemoveMember = useCallback(
    async (userId: string) => {
      if (!selectedTeam) return;
      try {
        await removeTeamMember(selectedTeam.id, userId, authToken);
        setMembers((prev) => prev.filter((m) => m.userId !== userId));
      } catch (err) {
        onError?.(
          err instanceof Error ? err.message : "Failed to remove member",
        );
      }
    },
    [selectedTeam, authToken, onError],
  );

  const handleRoleChange = useCallback(
    async (userId: string, role: TeamRole) => {
      if (!selectedTeam) return;
      try {
        await updateMemberRole(selectedTeam.id, userId, role, authToken);
        loadMembers(selectedTeam.id);
      } catch (err) {
        onError?.(err instanceof Error ? err.message : "Failed to update role");
      }
    },
    [selectedTeam, authToken, onError, loadMembers],
  );

  const handleDeleteTeam = useCallback(async () => {
    if (!selectedTeam) return;
    try {
      await deleteTeam(selectedTeam.id, authToken);
      setTeams((prev) => prev.filter((t) => t.id !== selectedTeam.id));
      setSelectedTeam(null);
      setMembers([]);
    } catch (err) {
      onError?.(err instanceof Error ? err.message : "Failed to delete team");
    }
  }, [selectedTeam, authToken, onError]);

  const currentMember = members.find((m) => m.userId === currentUserId);

  return (
    <div
      className="team-view"
      style={{ display: "flex", gap: 24, padding: 16 }}
    >
      <div className="team-list" style={{ flex: "0 0 240px" }}>
        <h3 style={{ margin: "0 0 12px" }}>Teams</h3>
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <input
            type="text"
            value={newTeamName}
            onChange={(e) => setNewTeamName(e.target.value)}
            placeholder="New team name"
            aria-label="New team name"
            style={{
              flex: 1,
              padding: "6px 10px",
              borderRadius: 6,
              border: "1px solid #444",
              background: "#1a1a2e",
              color: "#e0e0e0",
            }}
            onKeyDown={(e) => e.key === "Enter" && handleCreateTeam()}
          />
          <button
            onClick={handleCreateTeam}
            disabled={!newTeamName.trim()}
            aria-label="Create team"
            style={{
              padding: "6px 12px",
              borderRadius: 6,
              border: "none",
              background: "#6c5ce7",
              color: "#fff",
              cursor: "pointer",
            }}
          >
            +
          </button>
        </div>
        {loading && <p style={{ color: "#888" }}>Loading...</p>}
        {teams.map((team) => (
          <button
            key={team.id}
            onClick={() => handleSelectTeam(team)}
            aria-label={`Select team ${team.name}`}
            style={{
              display: "block",
              width: "100%",
              padding: "8px 12px",
              marginBottom: 4,
              borderRadius: 6,
              border:
                selectedTeam?.id === team.id
                  ? "1px solid #6c5ce7"
                  : "1px solid transparent",
              background: selectedTeam?.id === team.id ? "#2d2b55" : "#16162a",
              color: "#e0e0e0",
              textAlign: "left",
              cursor: "pointer",
            }}
          >
            {team.name}
            <span style={{ color: "#888", fontSize: 12, marginLeft: 8 }}>
              {team.members.length} members
            </span>
          </button>
        ))}
      </div>

      <div className="team-detail" style={{ flex: 1 }}>
        {selectedTeam ? (
          <>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 16,
              }}
            >
              <h3 style={{ margin: 0 }}>{selectedTeam.name}</h3>
              {currentMember && canDeleteTeam(currentMember) && (
                <button
                  onClick={handleDeleteTeam}
                  aria-label="Delete team"
                  style={{
                    padding: "4px 12px",
                    borderRadius: 6,
                    border: "1px solid #e74c3c",
                    background: "transparent",
                    color: "#e74c3c",
                    cursor: "pointer",
                  }}
                >
                  Delete Team
                </button>
              )}
            </div>

            {currentMember && canManageMembers(currentMember) && (
              <div
                style={{
                  display: "flex",
                  gap: 8,
                  marginBottom: 16,
                  padding: 12,
                  background: "#1a1a2e",
                  borderRadius: 8,
                }}
              >
                <input
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="Email to invite"
                  aria-label="Invite email"
                  style={{
                    flex: 1,
                    padding: "6px 10px",
                    borderRadius: 6,
                    border: "1px solid #444",
                    background: "#0d0d1a",
                    color: "#e0e0e0",
                  }}
                />
                <select
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value as TeamRole)}
                  aria-label="Invite role"
                  style={{
                    padding: "6px 10px",
                    borderRadius: 6,
                    border: "1px solid #444",
                    background: "#0d0d1a",
                    color: "#e0e0e0",
                  }}
                >
                  <option value="member">Member</option>
                  <option value="admin">Admin</option>
                </select>
                <button
                  onClick={handleInvite}
                  disabled={!inviteEmail.trim()}
                  aria-label="Send invite"
                  style={{
                    padding: "6px 16px",
                    borderRadius: 6,
                    border: "none",
                    background: "#6c5ce7",
                    color: "#fff",
                    cursor: "pointer",
                  }}
                >
                  Invite
                </button>
              </div>
            )}

            <h4 style={{ margin: "0 0 8px" }}>Members ({members.length})</h4>
            <div>
              {members.map((member) => (
                <div
                  key={member.userId}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "8px 12px",
                    borderRadius: 6,
                    background: "#16162a",
                    marginBottom: 4,
                  }}
                >
                  <div>
                    <span style={{ color: "#e0e0e0" }}>
                      {member.displayName}
                    </span>
                    <span
                      style={{ color: "#888", fontSize: 12, marginLeft: 8 }}
                    >
                      {member.email}
                    </span>
                  </div>
                  <div
                    style={{ display: "flex", alignItems: "center", gap: 8 }}
                  >
                    <span
                      style={{
                        padding: "2px 8px",
                        borderRadius: 4,
                        background:
                          member.role === "owner"
                            ? "#e17055"
                            : member.role === "admin"
                              ? "#6c5ce7"
                              : "#444",
                        color: "#fff",
                        fontSize: 11,
                        textTransform: "uppercase",
                      }}
                    >
                      {member.role}
                    </span>
                    {currentMember &&
                      canManageMembers(currentMember) &&
                      member.userId !== currentUserId &&
                      member.role !== "owner" && (
                        <>
                          <select
                            value={member.role}
                            onChange={(e) =>
                              handleRoleChange(
                                member.userId,
                                e.target.value as TeamRole,
                              )
                            }
                            aria-label={`Change role for ${member.displayName}`}
                            style={{
                              padding: "2px 6px",
                              borderRadius: 4,
                              border: "1px solid #444",
                              background: "#0d0d1a",
                              color: "#e0e0e0",
                              fontSize: 12,
                            }}
                          >
                            <option value="member">Member</option>
                            <option value="admin">Admin</option>
                          </select>
                          <button
                            onClick={() => handleRemoveMember(member.userId)}
                            aria-label={`Remove ${member.displayName}`}
                            style={{
                              padding: "2px 8px",
                              borderRadius: 4,
                              border: "1px solid #e74c3c",
                              background: "transparent",
                              color: "#e74c3c",
                              cursor: "pointer",
                              fontSize: 12,
                            }}
                          >
                            Remove
                          </button>
                        </>
                      )}
                  </div>
                </div>
              ))}
            </div>
          </>
        ) : (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              height: "100%",
              color: "#888",
            }}
          >
            Select a team or create a new one
          </div>
        )}
      </div>
    </div>
  );
}
