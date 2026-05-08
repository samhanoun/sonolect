import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import type { TeamMember } from "@sonolect/types";
import type { DictionaryEntry, Snippet } from "./wisprWorkflow";
import {
  createTeam,
  createTeamInvite,
  isInviteExpired,
  addTeamMember,
  removeTeamMember,
  hasPermission,
  mergeSharedDictionary,
  mergeSharedSnippets,
  resolveConflict,
  buildTeamSyncPayload,
  type TeamState,
} from "./teamCollaboration";

describe("teamCollaboration", () => {
  /* ─── createTeam ─── */
  describe("createTeam", () => {
    it("creates a team with a slug derived from the name", () => {
      const team = createTeam("My Awesome Team", "user-1");
      assert.equal(team.name, "My Awesome Team");
      assert.equal(team.slug, "my-awesome-team");
      assert.equal(team.ownerId, "user-1");
      assert.ok(team.id.startsWith("team-"));
      assert.ok(team.createdAt);
    });

    it("trims whitespace from the name", () => {
      const team = createTeam("  padded  ", "user-1");
      assert.equal(team.name, "padded");
      assert.equal(team.slug, "padded");
    });

    it("throws on empty name", () => {
      assert.throws(() => createTeam("", "user-1"), /must not be empty/);
      assert.throws(() => createTeam("   ", "user-1"), /must not be empty/);
    });
  });

  /* ─── createTeamInvite / isInviteExpired ─── */
  describe("createTeamInvite", () => {
    it("creates a pending invite with 7-day expiry", () => {
      const invite = createTeamInvite(
        "team-1",
        "Alice@Example.com",
        "member",
        "user-1",
      );
      assert.equal(invite.teamId, "team-1");
      assert.equal(invite.email, "alice@example.com");
      assert.equal(invite.role, "member");
      assert.equal(invite.status, "pending");
      assert.ok(invite.id.startsWith("inv-"));

      const created = Date.parse(invite.createdAt);
      const expires = Date.parse(invite.expiresAt);
      const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
      assert.equal(expires - created, sevenDaysMs);
    });

    it("supports admin role", () => {
      const invite = createTeamInvite(
        "team-1",
        "bob@example.com",
        "admin",
        "user-1",
      );
      assert.equal(invite.role, "admin");
    });
  });

  describe("isInviteExpired", () => {
    it("returns false for a fresh invite", () => {
      const invite = createTeamInvite("team-1", "a@b.com", "member", "user-1");
      assert.equal(isInviteExpired(invite), false);
    });

    it("returns true when expiresAt is in the past", () => {
      const invite = createTeamInvite("team-1", "a@b.com", "member", "user-1");
      invite.expiresAt = new Date(Date.now() - 1000).toISOString();
      assert.equal(isInviteExpired(invite), true);
    });

    it('returns true when status is "expired"', () => {
      const invite = createTeamInvite("team-1", "a@b.com", "member", "user-1");
      invite.status = "expired";
      assert.equal(isInviteExpired(invite), true);
    });
  });

  /* ─── Members ─── */
  describe("addTeamMember", () => {
    it("adds a new member to an empty list", () => {
      const result = addTeamMember([], "user-2", "team-1", "member");
      assert.equal(result.length, 1);
      assert.equal(result[0]!.userId, "user-2");
      assert.equal(result[0]!.role, "member");
    });

    it("does not add a duplicate member", () => {
      const members: TeamMember[] = [
        {
          userId: "user-2",
          teamId: "team-1",
          role: "member",
          joinedAt: "2025-01-01T00:00:00.000Z",
        },
      ];
      const result = addTeamMember(members, "user-2", "team-1", "admin");
      assert.equal(result.length, 1);
    });

    it("does not mutate the original array", () => {
      const original: TeamMember[] = [];
      const result = addTeamMember(original, "user-2", "team-1", "member");
      assert.equal(original.length, 0);
      assert.equal(result.length, 1);
    });
  });

  describe("removeTeamMember", () => {
    it("removes a member by userId", () => {
      const members: TeamMember[] = [
        {
          userId: "user-2",
          teamId: "team-1",
          role: "member",
          joinedAt: "2025-01-01T00:00:00.000Z",
        },
        {
          userId: "user-3",
          teamId: "team-1",
          role: "admin",
          joinedAt: "2025-01-01T00:00:00.000Z",
        },
      ];
      const result = removeTeamMember(members, "user-2");
      assert.equal(result.length, 1);
      assert.equal(result[0]!.userId, "user-3");
    });

    it("returns same list when userId not found", () => {
      const members: TeamMember[] = [
        {
          userId: "user-2",
          teamId: "team-1",
          role: "member",
          joinedAt: "2025-01-01T00:00:00.000Z",
        },
      ];
      const result = removeTeamMember(members, "nonexistent");
      assert.equal(result.length, 1);
    });
  });

  /* ─── Permissions ─── */
  describe("hasPermission", () => {
    const owner: TeamMember = {
      userId: "u1",
      teamId: "t1",
      role: "owner",
      joinedAt: "2025-01-01T00:00:00.000Z",
    };
    const admin: TeamMember = {
      userId: "u2",
      teamId: "t1",
      role: "admin",
      joinedAt: "2025-01-01T00:00:00.000Z",
    };
    const member: TeamMember = {
      userId: "u3",
      teamId: "t1",
      role: "member",
      joinedAt: "2025-01-01T00:00:00.000Z",
    };

    it("owner can do everything", () => {
      assert.equal(hasPermission(owner, "read"), true);
      assert.equal(hasPermission(owner, "write"), true);
      assert.equal(hasPermission(owner, "admin"), true);
      assert.equal(hasPermission(owner, "invite"), true);
    });

    it("admin can read, write, invite but not admin", () => {
      assert.equal(hasPermission(admin, "read"), true);
      assert.equal(hasPermission(admin, "write"), true);
      assert.equal(hasPermission(admin, "invite"), true);
      assert.equal(hasPermission(admin, "admin"), false);
    });

    it("member can read and write but not invite or admin", () => {
      assert.equal(hasPermission(member, "read"), true);
      assert.equal(hasPermission(member, "write"), true);
      assert.equal(hasPermission(member, "invite"), false);
      assert.equal(hasPermission(member, "admin"), false);
    });
  });

  /* ─── Dictionary merge ─── */
  describe("mergeSharedDictionary", () => {
    it("merges non-overlapping entries", () => {
      const local: DictionaryEntry[] = [
        { id: "d1", spoken: "react", replacement: "React" },
      ];
      const shared: DictionaryEntry[] = [
        { id: "d2", spoken: "ts", replacement: "TypeScript" },
      ];
      const result = mergeSharedDictionary(local, shared);
      assert.equal(result.length, 2);
    });

    it("shared wins on conflict (same spoken word)", () => {
      const local: DictionaryEntry[] = [
        { id: "d1", spoken: "react", replacement: "React (local)" },
      ];
      const shared: DictionaryEntry[] = [
        { id: "d2", spoken: "React", replacement: "React (shared)" },
      ];
      const result = mergeSharedDictionary(local, shared);
      assert.equal(result.length, 1);
      assert.equal(result[0]!.replacement, "React (shared)");
    });

    it("handles empty local list", () => {
      const shared: DictionaryEntry[] = [
        { id: "d1", spoken: "react", replacement: "React" },
      ];
      const result = mergeSharedDictionary([], shared);
      assert.equal(result.length, 1);
    });

    it("handles empty shared list", () => {
      const local: DictionaryEntry[] = [
        { id: "d1", spoken: "react", replacement: "React" },
      ];
      const result = mergeSharedDictionary(local, []);
      assert.equal(result.length, 1);
    });
  });

  /* ─── Snippet merge ─── */
  describe("mergeSharedSnippets", () => {
    it("merges non-overlapping snippets", () => {
      const local: Snippet[] = [
        { id: "s1", trigger: "/hello", body: "Hello!" },
      ];
      const shared: Snippet[] = [
        { id: "s2", trigger: "/bye", body: "Goodbye!" },
      ];
      const result = mergeSharedSnippets(local, shared);
      assert.equal(result.length, 2);
    });

    it("shared wins on conflict (same trigger)", () => {
      const local: Snippet[] = [
        { id: "s1", trigger: "/hello", body: "Hi (local)" },
      ];
      const shared: Snippet[] = [
        { id: "s2", trigger: "/Hello", body: "Hi (shared)" },
      ];
      const result = mergeSharedSnippets(local, shared);
      assert.equal(result.length, 1);
      assert.equal(result[0]!.body, "Hi (shared)");
    });
  });

  /* ─── Conflict resolution ─── */
  describe("resolveConflict", () => {
    const base = {
      id: "r1",
      teamId: "t1",
      resourceType: "dictionary" as const,
      data: { x: 1 },
      updatedBy: "user-1",
    };

    it("picks remote when remote has higher version", () => {
      const local = {
        ...base,
        version: 1,
        updatedAt: "2025-01-01T00:00:00.000Z",
      };
      const remote = {
        ...base,
        version: 2,
        updatedAt: "2025-01-01T00:00:00.000Z",
      };
      assert.equal(resolveConflict(local, remote), remote);
    });

    it("picks local when local has higher version", () => {
      const local = {
        ...base,
        version: 3,
        updatedAt: "2025-01-01T00:00:00.000Z",
      };
      const remote = {
        ...base,
        version: 2,
        updatedAt: "2025-06-01T00:00:00.000Z",
      };
      assert.equal(resolveConflict(local, remote), local);
    });

    it("picks remote on same version with later timestamp (last-write-wins)", () => {
      const local = {
        ...base,
        version: 1,
        updatedAt: "2025-01-01T00:00:00.000Z",
      };
      const remote = {
        ...base,
        version: 1,
        updatedAt: "2025-06-01T00:00:00.000Z",
      };
      assert.equal(resolveConflict(local, remote), remote);
    });

    it("picks local on same version when local has later timestamp", () => {
      const local = {
        ...base,
        version: 1,
        updatedAt: "2025-06-01T00:00:00.000Z",
      };
      const remote = {
        ...base,
        version: 1,
        updatedAt: "2025-01-01T00:00:00.000Z",
      };
      assert.equal(resolveConflict(local, remote), local);
    });

    it("picks remote on same version and same timestamp", () => {
      const ts = "2025-01-01T00:00:00.000Z";
      const local = { ...base, version: 1, updatedAt: ts };
      const remote = { ...base, version: 1, updatedAt: ts };
      assert.equal(resolveConflict(local, remote), remote);
    });
  });

  /* ─── Sync payload ─── */
  describe("buildTeamSyncPayload", () => {
    it("builds a manifest from state", () => {
      const state: TeamState = {
        currentTeam: {
          id: "team-1",
          name: "Test",
          slug: "test",
          ownerId: "user-1",
          createdAt: "2025-01-01T00:00:00.000Z",
        },
        members: [],
        sharedDictionary: [{ id: "d1", spoken: "react", replacement: "React" }],
        sharedSnippets: [{ id: "s1", trigger: "/hi", body: "Hello" }],
        pendingInvites: [],
      };

      const manifest = buildTeamSyncPayload(state);
      assert.equal(manifest.teamId, "team-1");
      assert.equal(manifest.resources.length, 2);
      assert.equal(manifest.resources[0]!.resourceType, "dictionary");
      assert.equal(manifest.resources[1]!.resourceType, "snippet");
      assert.ok(manifest.lastSyncAt);
    });

    it("throws when no current team", () => {
      const state: TeamState = {
        currentTeam: null,
        members: [],
        sharedDictionary: [],
        sharedSnippets: [],
        pendingInvites: [],
      };
      assert.throws(() => buildTeamSyncPayload(state), /No current team/);
    });

    it("returns empty resources for empty state", () => {
      const state: TeamState = {
        currentTeam: {
          id: "team-1",
          name: "Test",
          slug: "test",
          ownerId: "user-1",
          createdAt: "2025-01-01T00:00:00.000Z",
        },
        members: [],
        sharedDictionary: [],
        sharedSnippets: [],
        pendingInvites: [],
      };
      const manifest = buildTeamSyncPayload(state);
      assert.equal(manifest.resources.length, 0);
    });
  });
});
