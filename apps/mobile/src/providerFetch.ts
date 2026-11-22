import { fetch as expoFetch } from "expo/fetch";

/**
 * The fetch online editing uses on the phone. React Native's global fetch
 * follows redirects whatever `redirect` says; Expo's fetch honours
 * `redirect: "error"` on iOS and Android (and is the browser's fetch on
 * web). So, like the desktop, a redirect fails the request and the key is
 * never sent on to another address.
 */
export const providerFetch = expoFetch as unknown as typeof fetch;
