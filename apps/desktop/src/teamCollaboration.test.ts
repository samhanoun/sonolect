import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  hasPermission,
  canManageMembers,
  canDeleteTeam,
  canEditSharedResources,
  mergeDictionaries,
  mergeSnippets,
  findConflicts,
  resolveConflict,
  sortMembersByRole,
} from "./teamCollaboration";
import type { TeamMember } from "./teamApi";
import type { DictionaryEntry, Snippet } from "./wisprWorkflow";

const member = (role: "owner" | "admin" | "member"): TeamMember => ({
  userId: `user-${role}`,
  displayName: role,
  email: `${role}@test.com`,
  role,
  joinedAt: "2026-01-01T00:00:00Z",
});

describe("teamCollaboration", () => {
  describe("hasPermission", () => {
    it("owner has all permissions", () => {
      assert.ok(hasPermission(member("owner"), "owner"));
      assert.ok(hasPermission(member("owner"), "admin"));
      assert.ok(hasPermission(member("owner"), "member"));
    });

    it("admin cannot act as owner", () => {
      assert.ok(!hasPermission(member("admin"), "owner"));
      assert.ok(hasPermission(member("admin"), "admin"));
      assert.ok(hasPermission(member("admin"), "member"));
    });

    it("member has lowest permissions", () => {
      assert.ok(!hasPermission(member("member"), "owner"));
      assert.ok(!hasPermission(member("member"), "admin"));
      assert.ok(hasPermission(member("member"), "member"));
    });
  });

  describe("role checks", () => {
    it("canManageMembers requires admin", () => {
      assert.ok(canManageMembers(member("owner")));
      assert.ok(canManageMembers(member("admin")));
      assert.ok(!canManageMembers(member("member")));
    });

    it("canDeleteTeam requires owner", () => {
      assert.ok(canDeleteTeam(member("owner")));
      assert.ok(!canDeleteTeam(member("admin")));
    });

    it("canEditSharedResources allows member", () => {
      assert.ok(canEditSharedResources(member("member")));
    });
  });

  describe("mergeDictionaries", () => {
    it("merges without duplicates", () => {
      const local: DictionaryEntry[] = [
        { id: "1", spoken: "k8s", replacement: "Kubernetes" },
      ];
      const shared: DictionaryEntry[] = [
        { id: "2", spoken: "tf", replacement: "Terraform" },
        { id: "3", spoken: "K8S", replacement: "kubernetes" },
      ];
      const result = mergeDictionaries(local, shared);
      assert.equal(result.length, 2);
      assert.equal(result[0]!.replacement, "Kubernetes");
    });

    it("handles empty arrays", () => {
      assert.deepEqual(mergeDictionaries([], []), []);
    });
  });

  describe("mergeSnippets", () => {
    it("merges local-first", () => {
      const local: Snippet[] = [
        { id: "1", trigger: "sig", body: "Local Signature" },
      ];
      const shared: Snippet[] = [
        { id: "2", trigger: "SIG", body: "Shared Signature" },
        { id: "3", trigger: "addr", body: "123 Street" },
      ];
      const result = mergeSnippets(local, shared);
      assert.equal(result.length, 2);
      assert.equal(result[0]!.body, "Local Signature");
    });
  });

  describe("findConflicts", () => {
    it("detects conflicting entries", () => {
      const local: DictionaryEntry[] = [
        { id: "1", spoken: "api", replacement: "API" },
      ];
      const shared: DictionaryEntry[] = [
        {
          id: "2",
          spoken: "API",
          replacement: "Application Programming Interface",
        },
      ];
      const conflicts = findConflicts(local, shared);
      assert.equal(conflicts.length, 1);
      assert.equal(conflicts[0]!.localReplacement, "API");
      assert.equal(
        conflicts[0]!.sharedReplacement,
        "Application Programming Interface",
      );
    });

    it("no conflicts when replacements match", () => {
      const local: DictionaryEntry[] = [
        { id: "1", spoken: "api", replacement: "API" },
      ];
      const shared: DictionaryEntry[] = [
        { id: "2", spoken: "API", replacement: "API" },
      ];
      assert.equal(findConflicts(local, shared).length, 0);
    });
  });

  describe("resolveConflict", () => {
    const local: DictionaryEntry = {
      id: "1",
      spoken: "api",
      replacement: "API",
    };
    const shared: DictionaryEntry = {
      id: "2",
      spoken: "api",
      replacement: "Application Programming Interface",
    };

    it("keep-local returns local entry", () => {
      assert.equal(
        resolveConflict(local, shared, "keep-local").replacement,
        "API",
      );
    });

    it("use-shared returns shared entry", () => {
      assert.equal(
        resolveConflict(local, shared, "use-shared").replacement,
        "Application Programming Interface",
      );
    });
  });

  describe("sortMembersByRole", () => {
    it("sorts owner first, member last", () => {
      const members = [member("member"), member("owner"), member("admin")];
      const sorted = sortMembersByRole(members);
      assert.equal(sorted[0]!.role, "owner");
      assert.equal(sorted[1]!.role, "admin");
      assert.equal(sorted[2]!.role, "member");
    });
  });
});
