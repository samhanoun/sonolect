// Fails when sync-core source uses something Hermes (React Native) or the
// desktop webview may not have, or imports a module other than its own
// dependencies. tsc runs with no DOM and no Node types as well, so most such
// uses already fail to type-check; this catches the rest.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// A file path, not the URL's pathname: that is percent-encoded (a space is
// %20) and starts with /C:/ on Windows.
const root = fileURLToPath(new URL("../src/", import.meta.url));
const allowedImports = new Set([
  "@noble/ciphers/chacha.js",
  "@noble/hashes/hkdf.js",
  "@noble/hashes/hmac.js",
  "@noble/hashes/sha2.js",
  "fflate",
  "uqr",
]);
const forbidden = [
  [/\bBuffer\b/, "Buffer (Node only)"],
  [
    /\bTextEncoder\b|\bTextDecoder\b/,
    "TextEncoder/TextDecoder (missing or partial in Hermes)",
  ],
  [/\batob\b|\bbtoa\b/, "atob/btoa"],
  [/\bstructuredClone\b/, "structuredClone"],
  [
    /\bnew URL\b|\bURLSearchParams\b/,
    "URL/URLSearchParams (incomplete in React Native)",
  ],
  [/\bprocess\.|\brequire\(/, "Node globals"],
  [
    /\bcrypto\.|\bgetRandomValues\b/,
    "a global crypto (inject randomness instead)",
  ],
  [/\bwindow\.|\bdocument\.|\blocalStorage\b/, "browser globals"],
  [
    /\bthis\.#|(?:^\s*|[{;]\s*)(?:static\s+)?#[A-Za-z_$][\w$]*\s*[;=(]/m,
    "private # members",
  ],
  [
    /\.at\(|\bObject\.hasOwn\b|\.replaceAll\(|\.findLast\(/,
    "ES2022+ library methods",
  ],
];

const problems = [];
for (const name of readdirSync(root)) {
  if (
    !name.endsWith(".ts") ||
    name.endsWith(".test.ts") ||
    name === "test-helpers.ts"
  )
    continue;
  const text = readFileSync(join(root, name), "utf8");
  // Comments may mention anything; strip them before matching.
  const code = text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
  for (const [pattern, what] of forbidden)
    if (pattern.test(code)) problems.push(`${name}: uses ${what}`);
  for (const match of code.matchAll(/\bfrom\s+"([^"]+)"/g)) {
    const specifier = match[1];
    if (!specifier.startsWith("./") && !allowedImports.has(specifier))
      problems.push(`${name}: imports ${specifier}`);
  }
}
if (problems.length > 0) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log("sync-core is portable");
