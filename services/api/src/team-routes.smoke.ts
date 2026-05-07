import { strict as assert } from "node:assert";
import { createApp } from "./index.js";
import type { Team, TeamInvite, TeamMember } from "@sonolect/types";

const app = await createApp({ logger: false });

try {
  // Create a team
  const created = await app.inject({
    method: "POST",
    url: "/teams",
    payload: { name: "Smoke Team" },
  });
  assert.equal(created.statusCode, 201, created.body);
  const team = created.json<Team>();
  assert.equal(team.name, "Smoke Team");
  assert.equal(team.slug, "smoke-team");
  assert.ok(team.id);

  // List teams
  const listed = await app.inject({ method: "GET", url: "/teams" });
  assert.equal(listed.statusCode, 200);
  const teams = listed.json<Team[]>();
  assert.equal(teams.length, 1);
  assert.equal(teams[0]!.id, team.id);

  // Get team detail
  const detail = await app.inject({
    method: "GET",
    url: `/teams/${team.id}`,
  });
  assert.equal(detail.statusCode, 200);
  const detailBody = detail.json<{
    team: Team;
    members: TeamMember[];
    invites: TeamInvite[];
  }>();
  assert.equal(detailBody.team.id, team.id);
  assert.equal(detailBody.members.length, 1);
  assert.equal(detailBody.members[0]!.role, "owner");

  // Create invite
  const invited = await app.inject({
    method: "POST",
    url: `/teams/${team.id}/invite`,
    payload: { email: "colleague@example.com", role: "member" },
  });
  assert.equal(invited.statusCode, 201, invited.body);
  const invite = invited.json<TeamInvite>();
  assert.equal(invite.email, "colleague@example.com");
  assert.equal(invite.status, "pending");

  // Shared dictionary - empty initially
  const emptyDict = await app.inject({
    method: "GET",
    url: `/teams/${team.id}/shared/dictionary`,
  });
  assert.equal(emptyDict.statusCode, 200);
  assert.deepEqual(emptyDict.json<unknown[]>(), []);

  // Update shared dictionary
  const updateDict = await app.inject({
    method: "PUT",
    url: `/teams/${team.id}/shared/dictionary`,
    payload: [{ id: "d1", spoken: "foo", replacement: "bar" }],
  });
  assert.equal(updateDict.statusCode, 204);

  // Fetch updated dictionary
  const fetchedDict = await app.inject({
    method: "GET",
    url: `/teams/${team.id}/shared/dictionary`,
  });
  assert.equal(fetchedDict.statusCode, 200);
  const dictEntries = fetchedDict.json<unknown[]>();
  assert.equal(dictEntries.length, 1);

  // Shared snippets - empty initially
  const emptySnips = await app.inject({
    method: "GET",
    url: `/teams/${team.id}/shared/snippets`,
  });
  assert.equal(emptySnips.statusCode, 200);
  assert.deepEqual(emptySnips.json<unknown[]>(), []);

  // Update shared snippets
  const updateSnips = await app.inject({
    method: "PUT",
    url: `/teams/${team.id}/shared/snippets`,
    payload: [{ id: "s1", trigger: "/sig", body: "Best, Team" }],
  });
  assert.equal(updateSnips.statusCode, 204);

  // Fetch updated snippets
  const fetchedSnips = await app.inject({
    method: "GET",
    url: `/teams/${team.id}/shared/snippets`,
  });
  assert.equal(fetchedSnips.statusCode, 200);
  assert.equal(fetchedSnips.json<unknown[]>().length, 1);

  // Validation: create team with missing name
  const badCreate = await app.inject({
    method: "POST",
    url: "/teams",
    payload: {},
  });
  assert.equal(badCreate.statusCode, 400);

  // 404 on non-existent team
  const notFound = await app.inject({
    method: "GET",
    url: "/teams/non-existent",
  });
  assert.equal(notFound.statusCode, 404);
} finally {
  await app.close();
}

console.log("Team routes smoke test passed");
