# @sonolect/sync-e2e

Cross-client tests for note sync. They run in `pnpm test` (CI's Quality job).

One process holds a desktop, a phone and the sync service:

- **Desktop**: the webview's own sync code (`apps/desktop/src/sync`): the
  controller, the note store adapter, the transport and the state store. It
  runs over `FakeNative`, the desktop's in-memory stand-in for the Rust
  commands.
- **Phone**: the phone's own sync code (`apps/mobile/src/sync`): the
  controller, the note store adapter with its companion values, the key
  store and the fetch transport. It runs over the in-memory AsyncStorage and
  SecureStore of the phone's tests.
- **Server**: the real sync service (`services/sync-service`) on its memory
  store, called through Fastify's `inject`. No port is opened.

One shared clock moves every timer, so the 5-second debounce and the periodic
syncs run as they do in the apps, without waiting.

The tests prove that:

- a desktop capture reaches the phone with every field;
- a phone dictation's segments reach the desktop, whose studio saves them as
  subtitles, and a desktop note's segments are the phone's subtitles and go
  back as they came;
- times the studio estimated stay marked as estimates on the phone, and a
  typed note the studio saved gets no subtitles;
- the phone's edit, refine and pin come back to the desktop;
- deletes go both ways;
- a conflict leaves a copy on the side that loses;
- fields that one app does not know survive the other app;
- a device that joins with notes merges them;
- a phone back after two months finishes its full pass when the per-vault
  rate limit stops it part way, and then uploads;
- retention stays local;
- deleting the server copy turns the other device off, and its notes stay;
- the server never sees a note's text or a key.

```sh
pnpm --filter @sonolect/sync-e2e test
```
