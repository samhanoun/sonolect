import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

/**
 * The team stack is not wired into the app yet, and a build may have no
 * Supabase settings. Loading the module must not fail then.
 */
const { getSupabase, signInWithEmail } = await import("./supabaseClient");

describe("the Supabase client", () => {
  it("loads without settings, and says what is missing when used", async () => {
    assert.throws(() => getSupabase(), /VITE_SUPABASE_URL/);
    await assert.rejects(signInWithEmail("a@example.com", "x"), /not set up/);
  });
});
