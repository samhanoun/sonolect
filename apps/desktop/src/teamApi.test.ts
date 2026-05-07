import { describe, it, mock, beforeEach } from "node:test";
import { strict as assert } from "node:assert";
import {
  fetchTeams,
  fetchTeamDetail,
  createTeam,
  inviteToTeam,
  joinTeam,
  removeMember,
  fetchSharedDictionary,
  updateSharedDictionary,
  fetchSharedSnippets,
  updateSharedSnippets,
} from "./teamApi";

const MOCK_URL = "http://localhost:8080";
const MOCK_TOKEN = "test:user1";

const mockTeam = {
  id: "team-1",
  name: "Test Team",
  slug: "test-team",
  ownerId: "user1",
  createdAt: "2026-01-01T00:00:00.000Z",
};

const mockMember = {
  userId: "user1",
  teamId: "team-1",
  role: "owner" as const,
  joinedAt: "2026-01-01T00:00:00.000Z",
};

const mockInvite = {
  id: "inv-1",
  teamId: "team-1",
  email: "test@example.com",
  role: "member" as const,
  invitedBy: "user1",
  createdAt: "2026-01-01T00:00:00.000Z",
  expiresAt: "2026-01-08T00:00:00.000Z",
  status: "pending" as const,
};

function mockFetch(response: unknown, status = 200) {
  return mock.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => response,
    text: async () => JSON.stringify(response),
  }));
}

const originalFetch = globalThis.fetch;

beforeEach(() => {
  globalThis.fetch = originalFetch;
});

describe("teamApi", () => {
  describe("fetchTeams", () => {
    it("returns empty array when no API URL", async () => {
      const result = await fetchTeams(undefined, undefined);
      assert.deepEqual(result, []);
    });

    it("fetches teams from API", async () => {
      const fetchMock = mockFetch([mockTeam]);
      // @ts-expect-error -- mocking global fetch
      globalThis.fetch = fetchMock;
      const result = await fetchTeams(MOCK_URL, MOCK_TOKEN);
      assert.equal(result.length, 1);
      assert.equal(result[0]!.id, "team-1");
      assert.equal(fetchMock.mock.calls.length, 1);
    });
  });

  describe("fetchTeamDetail", () => {
    it("throws when no API URL", async () => {
      await assert.rejects(
        () => fetchTeamDetail(undefined, undefined, "team-1"),
        /API URL not configured/,
      );
    });

    it("returns team detail", async () => {
      const detail = { team: mockTeam, members: [mockMember], invites: [] };
      // @ts-expect-error -- mocking global fetch
      globalThis.fetch = mockFetch(detail);
      const result = await fetchTeamDetail(MOCK_URL, MOCK_TOKEN, "team-1");
      assert.equal(result.team.id, "team-1");
      assert.equal(result.members.length, 1);
    });
  });

  describe("createTeam", () => {
    it("throws when no API URL", async () => {
      await assert.rejects(
        () => createTeam(undefined, undefined, "Test"),
        /API URL not configured/,
      );
    });

    it("creates a team", async () => {
      // @ts-expect-error -- mocking global fetch
      globalThis.fetch = mockFetch(mockTeam, 201);
      const result = await createTeam(MOCK_URL, MOCK_TOKEN, "Test Team");
      assert.equal(result.name, "Test Team");
    });
  });

  describe("inviteToTeam", () => {
    it("sends invite", async () => {
      // @ts-expect-error -- mocking global fetch
      globalThis.fetch = mockFetch(mockInvite, 201);
      const result = await inviteToTeam(
        MOCK_URL,
        MOCK_TOKEN,
        "team-1",
        "test@example.com",
        "member",
      );
      assert.equal(result.email, "test@example.com");
    });
  });

  describe("joinTeam", () => {
    it("joins team with invite", async () => {
      const joined = { ...mockMember, userId: "user2", role: "member" };
      // @ts-expect-error -- mocking global fetch
      globalThis.fetch = mockFetch(joined, 201);
      const result = await joinTeam(MOCK_URL, MOCK_TOKEN, "team-1", "inv-1");
      assert.equal(result.userId, "user2");
    });
  });

  describe("removeMember", () => {
    it("removes member", async () => {
      // @ts-expect-error -- mocking global fetch
      globalThis.fetch = mock.fn(async () => ({
        ok: true,
        status: 204,
        json: async () => null,
        text: async () => "",
      }));
      await removeMember(MOCK_URL, MOCK_TOKEN, "team-1", "user2");
    });

    it("throws on error", async () => {
      // @ts-expect-error -- mocking global fetch
      globalThis.fetch = mock.fn(async () => ({
        ok: false,
        status: 404,
        json: async () => ({ error: "not_found" }),
        text: async () => '{"error":"not_found"}',
      }));
      await assert.rejects(
        () => removeMember(MOCK_URL, MOCK_TOKEN, "team-1", "ghost"),
        /HTTP 404/,
      );
    });
  });

  describe("fetchSharedDictionary", () => {
    it("returns empty when no URL", async () => {
      const result = await fetchSharedDictionary(undefined, undefined, "t1");
      assert.deepEqual(result, []);
    });

    it("fetches dictionary", async () => {
      const entries = [{ id: "d1", spoken: "foo", replacement: "bar" }];
      // @ts-expect-error -- mocking global fetch
      globalThis.fetch = mockFetch(entries);
      const result = await fetchSharedDictionary(
        MOCK_URL,
        MOCK_TOKEN,
        "team-1",
      );
      assert.equal(result.length, 1);
    });
  });

  describe("updateSharedDictionary", () => {
    it("sends dictionary update", async () => {
      // @ts-expect-error -- mocking global fetch
      globalThis.fetch = mock.fn(async () => ({
        ok: true,
        status: 204,
        json: async () => null,
        text: async () => "",
      }));
      await updateSharedDictionary(MOCK_URL, MOCK_TOKEN, "team-1", []);
    });
  });

  describe("fetchSharedSnippets", () => {
    it("returns empty when no URL", async () => {
      const result = await fetchSharedSnippets(undefined, undefined, "t1");
      assert.deepEqual(result, []);
    });

    it("fetches snippets", async () => {
      const snippets = [{ id: "s1", trigger: "/hi", body: "hello" }];
      // @ts-expect-error -- mocking global fetch
      globalThis.fetch = mockFetch(snippets);
      const result = await fetchSharedSnippets(MOCK_URL, MOCK_TOKEN, "team-1");
      assert.equal(result.length, 1);
    });
  });

  describe("updateSharedSnippets", () => {
    it("sends snippets update", async () => {
      // @ts-expect-error -- mocking global fetch
      globalThis.fetch = mock.fn(async () => ({
        ok: true,
        status: 204,
        json: async () => null,
        text: async () => "",
      }));
      await updateSharedSnippets(MOCK_URL, MOCK_TOKEN, "team-1", []);
    });
  });
});
