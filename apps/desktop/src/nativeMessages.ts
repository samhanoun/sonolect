/**
 * The native side (Rust) reports errors as English sentences. This module
 * shows them in the interface language: every `native.*` locale key holds the
 * exact English sentence the native code sends, so the English text doubles as
 * the lookup key. A message without an entry is shown as it arrived.
 */
import { getT, type LocaleKeys, type Translator } from "./i18n";
import { en } from "./locales/en";

type DynamicMessage = { key: LocaleKeys; pattern: RegExp };

const staticMessages = new Map<string, LocaleKeys>();
const dynamicMessages: DynamicMessage[] = [];

for (const [key, template] of Object.entries(en) as [LocaleKeys, string][]) {
  if (!key.startsWith("native.")) continue;
  if (!template.includes("{")) {
    staticMessages.set(template, key);
    continue;
  }
  const source = template
    .split(/(\{\w+\})/)
    .map((part) =>
      /^\{\w+\}$/.test(part)
        ? `(?<${part.slice(1, -1)}>[\\s\\S]*?)`
        : part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    )
    .join("");
  dynamicMessages.push({ key, pattern: new RegExp(`^${source}$`) });
}

export function localizeNativeMessage(
  message: string,
  t: Translator = getT(),
): string {
  if (t.locale === "en") return message;
  const exact = staticMessages.get(message);
  if (exact) return t(exact);
  for (const { key, pattern } of dynamicMessages) {
    const match = pattern.exec(message);
    if (match) return t(key, match.groups ?? {});
  }
  return message;
}

/** Every English sentence this module can translate, for the drift test. */
export function nativeMessageTemplates(): string[] {
  return (Object.entries(en) as [LocaleKeys, string][])
    .filter(([key]) => key.startsWith("native."))
    .map(([, template]) => template);
}
