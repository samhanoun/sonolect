import * as assert from "node:assert/strict";
import { describe, it } from "node:test";

import { strings } from "./i18n";
import type { CatalogModel, OnlineEditing } from "./onlineRefine";
import {
  MODEL_LIST_LIMIT,
  chooseModel,
  filterModels,
  onlineEditingStatus,
} from "./onlineSettings";

const EDITING: OnlineEditing = {
  provider: "openrouter",
  model: "openai/gpt-6-mini",
  alwaysAllow: true,
};

const MODELS: CatalogModel[] = [
  { id: "acme/fast-1", name: "Acme Fast" },
  { id: "acme/large-2", name: "Acme Large" },
  { id: "other/notes-3", name: "Notes Writer" },
];

describe("online editing status", () => {
  const t = strings("en").settings.onlineEditing;

  it("says when nothing is set up", () => {
    assert.equal(
      onlineEditingStatus(t, undefined, { openrouter: true, opencode: true }),
      "Not set up. Rewrite and Reply stay hidden.",
    );
  });

  it("names the provider and the model in use", () => {
    assert.equal(
      onlineEditingStatus(t, EDITING, { openrouter: true, opencode: false }),
      "Rewrite and Reply use OpenRouter (openai/gpt-6-mini).",
    );
  });

  it("asks for the key of the chosen provider only", () => {
    assert.equal(
      onlineEditingStatus(t, EDITING, { openrouter: false, opencode: true }),
      "Rewrite and Reply use OpenRouter (openai/gpt-6-mini). Save your OpenRouter key to turn it on.",
    );
    const fr = strings("fr").settings.onlineEditing;
    assert.equal(
      onlineEditingStatus(
        fr,
        { ...EDITING, provider: "opencode", model: "zen-model" },
        { openrouter: true, opencode: false },
      ),
      "Réécrire et Répondre utilisent OpenCode Zen (zen-model). Enregistrez votre clé OpenCode Zen pour l'activer.",
    );
  });
});

describe("model list filter", () => {
  it("matches the id or the name, ignoring case", () => {
    assert.deepEqual(
      filterModels(MODELS, "LARGE").map((m) => m.id),
      ["acme/large-2"],
    );
    assert.deepEqual(
      filterModels(MODELS, "writer").map((m) => m.id),
      ["other/notes-3"],
    );
    assert.deepEqual(
      filterModels(MODELS, " acme ").map((m) => m.id),
      ["acme/fast-1", "acme/large-2"],
    );
    assert.deepEqual(filterModels(MODELS, "nothing"), []);
  });

  it("lists the first models for an empty field, up to the limit", () => {
    const many = Array.from({ length: 100 }, (_, i) => ({
      id: `acme/m-${i}`,
      name: `M ${i}`,
    }));
    assert.equal(filterModels(many, "").length, MODEL_LIST_LIMIT);
    assert.deepEqual(filterModels(MODELS, "", 2), MODELS.slice(0, 2));
  });
});

describe("choosing a model", () => {
  it("stores only a valid, trimmed model id", () => {
    assert.deepEqual(chooseModel(undefined, "opencode", "  zen-model "), {
      provider: "opencode",
      model: "zen-model",
      alwaysAllow: false,
    });
    for (const bad of ["", "   ", "a b", "../secret", "x?y=1"]) {
      assert.equal(chooseModel(EDITING, "openrouter", bad), undefined);
    }
  });

  it("keeps Send without asking for the same provider only", () => {
    assert.equal(
      chooseModel(EDITING, "openrouter", "acme/large-2")?.alwaysAllow,
      true,
    );
    // A new provider is a new third party: it asks again.
    assert.equal(
      chooseModel(EDITING, "opencode", "zen-model")?.alwaysAllow,
      false,
    );
    assert.equal(
      chooseModel(
        { ...EDITING, alwaysAllow: false },
        "openrouter",
        "acme/large-2",
      )?.alwaysAllow,
      false,
    );
  });
});
