import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  EDGE_VOICES,
  OPENAI_VOICES,
  getVoicesForLanguage,
  getVoicesByProvider,
  getAllVoices,
  findVoiceById,
  detectLanguage,
} from "./voiceCatalog";

describe("voiceCatalog", () => {
  describe("EDGE_VOICES", () => {
    it("contains at least 30 voices", () => {
      assert.ok(EDGE_VOICES.length >= 30);
    });

    it("all entries have premium set to false", () => {
      for (const v of EDGE_VOICES) {
        assert.equal(v.premium, false, `${v.id} should not be premium`);
      }
    });

    it("all entries have provider set to edge", () => {
      for (const v of EDGE_VOICES) {
        assert.equal(v.provider, "edge");
      }
    });

    it("has unique ids", () => {
      const ids = EDGE_VOICES.map((v) => v.id);
      assert.equal(new Set(ids).size, ids.length);
    });
  });

  describe("OPENAI_VOICES", () => {
    it("contains exactly 6 voices", () => {
      assert.equal(OPENAI_VOICES.length, 6);
    });

    it("all entries have premium set to true", () => {
      for (const v of OPENAI_VOICES) {
        assert.equal(v.premium, true);
      }
    });

    it("includes alloy, echo, fable, onyx, nova, shimmer", () => {
      const names = OPENAI_VOICES.map((v) => v.name).sort();
      assert.deepEqual(names, [
        "alloy",
        "echo",
        "fable",
        "nova",
        "onyx",
        "shimmer",
      ]);
    });
  });

  describe("getVoicesForLanguage", () => {
    it("returns English voices for 'en'", () => {
      const voices = getVoicesForLanguage("en");
      const edgeVoices = voices.filter((v) => v.provider === "edge");
      assert.ok(edgeVoices.length >= 7);
      for (const v of edgeVoices) {
        assert.ok(v.languageCode.startsWith("en"));
      }
    });

    it("returns French voices for 'fr'", () => {
      const voices = getVoicesForLanguage("fr");
      const edgeVoices = voices.filter((v) => v.provider === "edge");
      assert.ok(edgeVoices.length >= 3);
    });

    it("returns Arabic voices for 'ar'", () => {
      const voices = getVoicesForLanguage("ar");
      const edgeVoices = voices.filter((v) => v.provider === "edge");
      assert.ok(edgeVoices.length >= 3);
    });

    it("includes OpenAI multilingual voices for any language", () => {
      const voices = getVoicesForLanguage("ja");
      const openai = voices.filter((v) => v.provider === "openai");
      assert.equal(openai.length, 6);
    });

    it("matches by prefix so en matches en-US and en-GB", () => {
      const voices = getVoicesForLanguage("en");
      const codes = new Set(
        voices.filter((v) => v.provider === "edge").map((v) => v.languageCode),
      );
      assert.ok(codes.has("en-US"));
      assert.ok(codes.has("en-GB"));
    });
  });

  describe("getVoicesByProvider", () => {
    it("returns only edge voices for provider edge", () => {
      const voices = getVoicesByProvider("edge");
      assert.equal(voices.length, EDGE_VOICES.length);
      for (const v of voices) {
        assert.equal(v.provider, "edge");
      }
    });

    it("returns only openai voices for provider openai", () => {
      const voices = getVoicesByProvider("openai");
      assert.equal(voices.length, OPENAI_VOICES.length);
      for (const v of voices) {
        assert.equal(v.provider, "openai");
      }
    });

    it("returns empty array for browser provider (no static browser voices)", () => {
      const voices = getVoicesByProvider("browser");
      assert.equal(voices.length, 0);
    });
  });

  describe("getAllVoices", () => {
    it("returns all edge and openai voices combined", () => {
      const all = getAllVoices();
      assert.equal(all.length, EDGE_VOICES.length + OPENAI_VOICES.length);
    });
  });

  describe("findVoiceById", () => {
    it("finds an existing voice", () => {
      const voice = findVoiceById("edge-en-US-AriaNeural");
      assert.ok(voice);
      assert.equal(voice!.name, "en-US-AriaNeural");
    });

    it("finds an OpenAI voice", () => {
      const voice = findVoiceById("openai-nova");
      assert.ok(voice);
      assert.equal(voice!.name, "nova");
    });

    it("returns null for unknown id", () => {
      const voice = findVoiceById("nonexistent-voice");
      assert.equal(voice, null);
    });
  });

  describe("detectLanguage", () => {
    it("detects Arabic text", () => {
      assert.equal(detectLanguage("مرحبا بالعالم"), "ar");
    });

    it("detects Chinese text", () => {
      assert.equal(detectLanguage("你好世界"), "zh");
    });

    it("detects Japanese text", () => {
      assert.equal(detectLanguage("こんにちは世界"), "ja");
    });

    it("detects Korean text", () => {
      assert.equal(detectLanguage("안녕하세요 세계"), "ko");
    });

    it("detects Hindi text", () => {
      assert.equal(detectLanguage("नमस्ते दुनिया"), "hi");
    });

    it("detects French text", () => {
      assert.equal(
        detectLanguage(
          "Je suis dans la maison avec les enfants et nous avons une belle vue",
        ),
        "fr",
      );
    });

    it("detects Spanish text", () => {
      assert.equal(
        detectLanguage(
          "El gato está en la casa con los niños y una mesa para todos",
        ),
        "es",
      );
    });

    it("detects German text", () => {
      assert.equal(
        detectLanguage(
          "Das ist ein Buch und die Kinder sind auf dem Tisch mit der Katze",
        ),
        "de",
      );
    });

    it("defaults to English for English text", () => {
      assert.equal(
        detectLanguage("The quick brown fox jumps over the lazy dog"),
        "en",
      );
    });

    it("defaults to English for empty text", () => {
      assert.equal(detectLanguage(""), "en");
    });

    it("defaults to English for single unknown word", () => {
      assert.equal(detectLanguage("xylophone"), "en");
    });
  });
});
