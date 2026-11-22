import * as assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { CompanionSettings, TranscriptTurn } from "./domain";
import { DEFAULT_SETTINGS } from "./domain";
import type { OnlineEditInput } from "./onlineEdit";
import {
  consentCovers,
  planOnlineEdit,
  refiningFor,
  runOnlineEdit,
} from "./onlineEdit";
import type { OnlineEditing } from "./onlineRefine";
import type { SecureItemStore } from "./providerKeys";
import { createProviderKeyStore } from "./providerKeys";
import { refineLocally } from "./refine";

const KEY = "test-key-not-real-0000";

const EDITING: OnlineEditing = {
  provider: "openrouter",
  model: "openai/gpt-example-mini",
  alwaysAllow: false,
};

const TURN: TranscriptTurn = {
  id: "turn_1",
  rawText: "um so tell sam lect thursday works",
  refinedText: "So tell sam lect thursday works",
  mode: "dictate",
  language: "en-US",
  privacyMode: false,
  createdAt: "2026-11-21T10:00:00.000Z",
  durationMs: 4000,
  source: "microphone",
  syncState: "local",
};

const DICTIONARY = [
  { id: "d1", spoken: "sam lect", replacement: "Sonolect" },
  { id: "d2", spoken: "kube", replacement: "Kubernetes" },
];

type Call = { url: string; init: RequestInit };

function fakeFetch(respond: () => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetchImpl = (async (
    url: string | URL | Request,
    init?: RequestInit,
  ) => {
    calls.push({ url: String(url), init: init ?? {} });
    return respond();
  }) as typeof fetch;
  return { fetchImpl, calls };
}

const reply = (text: string) =>
  new Response(JSON.stringify({ choices: [{ message: { content: text } }] }), {
    status: 200,
  });

/** A phone with a saved key, the turn in its history and a mocked fetch. */
function setup(
  overrides: Omit<Partial<OnlineEditInput>, "settings"> & {
    settings?: Partial<CompanionSettings>;
    respond?: () => Response | Promise<Response>;
  } = {},
) {
  const { respond, settings, ...rest } = overrides;
  const { fetchImpl, calls } = fakeFetch(respond ?? (() => reply("Done.")));
  const keyReads: string[] = [];
  const sends: OnlineEditing[] = [];
  let notes: TranscriptTurn[] = [TURN];
  const input: OnlineEditInput = {
    turn: TURN,
    mode: "rewrite",
    consentedTo: EDITING,
    web: false,
    settings: { ...DEFAULT_SETTINGS, onlineEditing: EDITING, ...settings },
    keySaved: { openrouter: true, opencode: false },
    dictionary: DICTIONARY,
    snippets: [],
    readKey: async (provider) => {
      keyReads.push(provider);
      return KEY;
    },
    current: () => notes.find((turn) => turn.id === TURN.id),
    onSend: (editing) => sends.push(editing),
    fetchImpl,
    ...rest,
  };
  return {
    input,
    calls,
    keyReads,
    sends,
    erase: () => {
      notes = [];
    },
  };
}

describe("asking first", () => {
  it("reads no key and sends nothing until the user agrees", async () => {
    const { input, calls, keyReads, sends } = setup({ consentedTo: undefined });
    for (const mode of ["rewrite", "reply"] as const) {
      assert.deepEqual(await runOnlineEdit({ ...input, mode }), {
        kind: "ask",
        editing: EDITING,
      });
    }
    assert.equal(calls.length, 0);
    assert.equal(keyReads.length, 0);
    assert.equal(sends.length, 0);
  });

  it("sends without asking only with Always allow, never in Ephemeral", async () => {
    const always = { ...EDITING, alwaysAllow: true };
    const standard = setup({
      consentedTo: undefined,
      settings: { privacyLevel: "standard", onlineEditing: always },
    });
    assert.equal((await runOnlineEdit(standard.input)).kind, "applied");
    assert.equal(standard.calls.length, 1);

    const ephemeral = setup({
      consentedTo: undefined,
      settings: { privacyLevel: "ephemeral", onlineEditing: always },
    });
    assert.equal((await runOnlineEdit(ephemeral.input)).kind, "ask");
    assert.equal(ephemeral.calls.length, 0);
    // The dialog's Send still works in Ephemeral.
    assert.equal(
      (await runOnlineEdit({ ...ephemeral.input, consentedTo: always })).kind,
      "applied",
    );
  });

  it("asks for a note made in Ephemeral after the user left Ephemeral", async () => {
    const always = { ...EDITING, alwaysAllow: true };
    for (const privacyLevel of ["local_first", "standard"] as const) {
      const { input, calls, keyReads } = setup({
        consentedTo: undefined,
        ephemeralNote: true,
        settings: { privacyLevel, onlineEditing: always },
      });
      assert.equal((await runOnlineEdit(input)).kind, "ask");
      assert.equal(calls.length, 0);
      assert.equal(keyReads.length, 0);
      assert.equal(
        (await runOnlineEdit({ ...input, consentedTo: always })).kind,
        "applied",
      );
    }
  });

  it("leaves Clean up, Summarize, Tasks and the web preview on the phone", async () => {
    for (const mode of ["dictate", "summarize", "task_creation"] as const) {
      const { input, calls } = setup({ mode });
      assert.deepEqual(await runOnlineEdit(input), { kind: "local" });
      assert.equal(calls.length, 0);
    }
    const web = setup({ web: true });
    assert.deepEqual(await runOnlineEdit(web.input), { kind: "local" });
    assert.equal(web.calls.length, 0);
    assert.equal(web.keyReads.length, 0);
  });

  it("takes a consent only for the provider and model it named", async () => {
    for (const consentedTo of [
      { provider: "openrouter", model: "anthropic/claude-example-1" },
      { provider: "opencode", model: EDITING.model },
    ] as const) {
      const { input, calls, keyReads } = setup({ consentedTo });
      assert.equal((await runOnlineEdit(input)).kind, "ask");
      assert.equal(calls.length, 0);
      assert.equal(keyReads.length, 0);
    }
    assert.equal(consentCovers(EDITING, { onlineEditing: EDITING }), true);
    assert.equal(consentCovers(EDITING, {}), false);
    assert.equal(consentCovers(undefined, { onlineEditing: EDITING }), false);
  });

  it("plans with the key of the chosen provider only", () => {
    const plan = (keySaved: { openrouter: boolean; opencode: boolean }) =>
      planOnlineEdit({
        mode: "reply",
        settings: { privacyLevel: "local_first", onlineEditing: EDITING },
        keySaved,
        web: false,
        consentedNow: false,
      }).kind;
    assert.equal(plan({ openrouter: true, opencode: false }), "ask");
    assert.equal(plan({ openrouter: false, opencode: true }), "unavailable");
  });
});

describe("after consent", () => {
  it("sends exactly one request, to the chosen endpoint", async () => {
    const { input, calls, keyReads, sends } = setup();
    const outcome = await runOnlineEdit(input);
    assert.equal(outcome.kind, "applied");
    assert.equal(calls.length, 1);
    assert.equal(
      calls[0]?.url,
      "https://openrouter.ai/api/v1/chat/completions",
    );
    assert.deepEqual(keyReads, ["openrouter"]);
    assert.deepEqual(sends, [EDITING]);
    const headers = calls[0]?.init.headers as Record<string, string>;
    assert.equal(headers.authorization, `Bearer ${KEY}`);
    assert.ok(!String(calls[0]?.init.body).includes(KEY));

    const zen: OnlineEditing = {
      ...EDITING,
      provider: "opencode",
      model: "claude-example-1",
    };
    const opencode = setup({
      settings: { onlineEditing: zen },
      consentedTo: zen,
      keySaved: { openrouter: false, opencode: true },
      respond: () =>
        new Response(JSON.stringify({ content: [{ text: "Fine." }] }), {
          status: 200,
        }),
    });
    assert.equal((await runOnlineEdit(opencode.input)).kind, "applied");
    assert.equal(
      opencode.calls[0]?.url,
      "https://opencode.ai/inference/anthropic/v1/messages",
    );
    assert.deepEqual(opencode.keyReads, ["opencode"]);
  });

  it("applies the dictionary on the phone and never sends it", async () => {
    const { input, calls } = setup();
    await runOnlineEdit(input);
    const body = String(calls[0]?.init.body);
    assert.match(body, /tell Sonolect thursday works/);
    assert.doesNotMatch(body, /sam lect/);
    assert.doesNotMatch(body, /Kubernetes|kube/);
    assert.doesNotMatch(body, /\bum\b/);
  });

  it("keeps rawText, so Clean up brings the original back", async () => {
    const { input } = setup({
      respond: () => reply("Please tell Sonolect that Thursday works."),
    });
    const outcome = await runOnlineEdit(input);
    assert.equal(outcome.kind, "applied");
    if (outcome.kind !== "applied") return;
    assert.equal(outcome.turn.mode, "rewrite");
    assert.equal(
      outcome.turn.refinedText,
      "Please tell Sonolect that Thursday works.",
    );
    assert.equal(outcome.turn.rawText, TURN.rawText);
    assert.equal(outcome.turn.id, TURN.id);
    assert.equal(
      refineLocally(outcome.turn.rawText, "dictate", {
        language: "en-US",
        dictionary: DICTIONARY,
      }),
      refineLocally(TURN.rawText, "dictate", {
        language: "en-US",
        dictionary: DICTIONARY,
      }),
    );
  });

  it("applies the result to the note as it is now", async () => {
    let pinned = false;
    const { input } = setup({
      respond: () => {
        pinned = true;
        return reply("Done.");
      },
      current: () => ({ ...TURN, pinned }),
    });
    const outcome = await runOnlineEdit(input);
    assert.equal(outcome.kind === "applied" && outcome.turn.pinned, true);
  });
});

describe("failures", () => {
  it("shows the matching notice and leaves the note unchanged", async () => {
    const cases: [() => Response | Promise<Response>, string][] = [
      [() => new Response("{}", { status: 401 }), "onlineKeyRejected"],
      [() => new Response("{}", { status: 402 }), "onlineNeedsCredits"],
      [() => new Response("{}", { status: 429 }), "onlineRateLimited"],
      [() => new Response("{}", { status: 404 }), "onlineModelUnavailable"],
      [() => new Response("{}", { status: 500 }), "onlineFailed"],
      [() => reply("   "), "onlineEmpty"],
      [
        () => {
          throw new TypeError("Network request failed");
        },
        "onlineNetwork",
      ],
    ];
    for (const [respond, notice] of cases) {
      const before = JSON.stringify(TURN);
      const { input } = setup({ respond });
      const outcome = await runOnlineEdit(input);
      assert.deepEqual(outcome, { kind: "failed", notice });
      // The note object itself was not touched.
      assert.equal(JSON.stringify(TURN), before);
    }
  });

  it("times out after the limit", async () => {
    const { input } = setup({
      timeoutMs: 10,
      fetchImpl: ((_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        })) as typeof fetch,
    });
    assert.deepEqual(await runOnlineEdit(input), {
      kind: "failed",
      notice: "onlineTimeout",
    });
  });

  it("sends nothing for a note over 12,000 characters, and does not ask", async () => {
    // Different words: the clean-up would merge repeated ones.
    const rawText = Array.from({ length: 2500 }, (_, i) => `w${i}`).join(" ");
    const long = { ...TURN, rawText };
    for (const consentedTo of [EDITING, undefined]) {
      const { input, calls, keyReads, sends } = setup({
        turn: long,
        current: () => long,
        consentedTo,
      });
      assert.deepEqual(await runOnlineEdit(input), {
        kind: "failed",
        notice: "onlineTooLong",
      });
      assert.equal(calls.length, 0);
      assert.equal(keyReads.length, 0);
      assert.equal(sends.length, 0);
    }
  });

  it("does not ask for a note with nothing left to send", async () => {
    // Saved as typed, but the clean-up removes every word.
    const fillers = { ...TURN, rawText: "um uh", source: "typed" as const };
    for (const consentedTo of [EDITING, undefined]) {
      const { input, calls, keyReads, sends } = setup({
        turn: fillers,
        current: () => fillers,
        consentedTo,
      });
      assert.deepEqual(await runOnlineEdit(input), {
        kind: "failed",
        notice: "onlineNothingToSend",
      });
      assert.equal(calls.length, 0);
      assert.equal(keyReads.length, 0);
      assert.equal(sends.length, 0);
    }
  });

  it("plans no dialog for a note that could never be sent", () => {
    const plan = (text: string | undefined, consentedNow = false) =>
      planOnlineEdit({
        mode: "rewrite",
        settings: { privacyLevel: "local_first", onlineEditing: EDITING },
        keySaved: { openrouter: true, opencode: false },
        web: false,
        consentedNow,
        text,
      });
    assert.deepEqual(plan(""), {
      kind: "unsendable",
      notice: "onlineNothingToSend",
    });
    assert.deepEqual(plan("  \n "), {
      kind: "unsendable",
      notice: "onlineNothingToSend",
    });
    assert.deepEqual(plan("x".repeat(12_001), true), {
      kind: "unsendable",
      notice: "onlineTooLong",
    });
    assert.equal(plan("x".repeat(12_000)).kind, "ask");
    assert.equal(plan("Thursday works.").kind, "ask");
    // Without the text, only the consent is planned.
    assert.equal(plan(undefined).kind, "ask");
    // Clean up stays on the phone, whatever its text.
    assert.equal(
      planOnlineEdit({
        mode: "dictate",
        settings: { privacyLevel: "local_first", onlineEditing: EDITING },
        keySaved: { openrouter: true, opencode: false },
        web: false,
        consentedNow: false,
        text: "",
      }).kind,
      "local",
    );
  });

  it("asks to set up again when the key is gone at send time", async () => {
    for (const readKey of [
      async () => undefined,
      async () => {
        throw new Error("keychain locked");
      },
    ]) {
      const { input, calls } = setup({ readKey });
      assert.deepEqual(await runOnlineEdit(input), {
        kind: "failed",
        notice: "onlineSetup",
      });
      assert.equal(calls.length, 0);
    }
  });
});

describe("a note that goes away during the request", () => {
  it("writes nothing after an Erase all", async () => {
    let erase = () => undefined as void;
    const harness = setup({
      respond: () => {
        // Erase all runs while the provider answers.
        erase();
        return reply("Done.");
      },
    });
    erase = harness.erase;
    assert.deepEqual(await runOnlineEdit(harness.input), { kind: "stale" });
    assert.equal(harness.calls.length, 1);
  });

  it("shows nothing when the request also failed", async () => {
    let erase = () => undefined as void;
    const harness = setup({
      respond: () => {
        erase();
        return new Response("{}", { status: 500 });
      },
    });
    erase = harness.erase;
    assert.deepEqual(await runOnlineEdit(harness.input), { kind: "stale" });
  });

  it("sends nothing when the note was deleted while the key was read", async () => {
    // The key is found, or not: either way the note is gone and not sent.
    for (const found of [KEY, undefined]) {
      let erase = () => undefined as void;
      const harness = setup({
        readKey: async () => {
          erase();
          return found;
        },
      });
      erase = harness.erase;
      assert.deepEqual(await runOnlineEdit(harness.input), { kind: "stale" });
      assert.equal(harness.calls.length, 0);
    }
  });
});

describe("the key", () => {
  it("never appears in an outcome, a sent body or the settings", async () => {
    const outcomes = [];
    for (const status of [200, 401, 402, 429, 500]) {
      const { input, calls } = setup({
        respond: () =>
          status === 200
            ? reply(`Here is ${KEY}`.replace(KEY, "your note"))
            : new Response(JSON.stringify({ error: `bad key ${KEY}` }), {
                status,
              }),
      });
      const outcome = await runOnlineEdit(input);
      outcomes.push(outcome);
      assert.ok(!String(calls[0]?.init.body).includes(KEY));
      assert.ok(!JSON.stringify(input.settings).includes(KEY));
    }
    assert.ok(!JSON.stringify(outcomes).includes(KEY));
    assert.ok(!JSON.stringify(outcomes).includes("bad key"));
  });

  it("is read from the secure store at send time", async () => {
    const items = new Map<string, string>();
    const secure: SecureItemStore = {
      getItemAsync: async (key) => items.get(key) ?? null,
      setItemAsync: async (key, value) => {
        items.set(key, value);
      },
      deleteItemAsync: async (key) => {
        items.delete(key);
      },
    };
    const keys = createProviderKeyStore(secure, () => ({}));
    await keys.save("openrouter", KEY);
    const { input, calls } = setup({
      readKey: (provider) => keys.load(provider),
    });
    assert.equal((await runOnlineEdit(input)).kind, "applied");
    assert.equal(
      (calls[0]?.init.headers as Record<string, string>).authorization,
      `Bearer ${KEY}`,
    );
    // Removed from Settings: the next send finds no key and sends nothing.
    await keys.remove("openrouter");
    const after = setup({ readKey: (provider) => keys.load(provider) });
    assert.deepEqual(await runOnlineEdit(after.input), {
      kind: "failed",
      notice: "onlineSetup",
    });
    assert.equal(after.calls.length, 0);
  });
});

describe("the busy state", () => {
  it("shows only on the note that was sent", () => {
    const state = {
      refining: true,
      refiningId: TURN.id,
      refiningMode: "rewrite",
      sendingTo: "openrouter",
    } as const;
    assert.deepEqual(refiningFor(state, TURN.id), {
      mode: "rewrite",
      sendingTo: "openrouter",
    });
    // A note dictated while the provider answers keeps its chips.
    assert.equal(refiningFor(state, "turn_2"), null);
    assert.equal(
      refiningFor(
        {
          refining: false,
          refiningId: null,
          refiningMode: null,
          sendingTo: null,
        },
        TURN.id,
      ),
      null,
    );
  });
});
