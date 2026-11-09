## 2025-02-14 - Fix Command Injection in Local STT Execution

**Vulnerability:** A CRITICAL command injection vulnerability existed in the `services/worker-service/src/local-audio-worker.ts` file, where user-supplied input was dynamically placed into an `exec` string format that executed shell commands.
**Learning:** `exec` executes via a shell which makes it vulnerable to injection via single quotes on windows systems, as well as complex inputs. String interpolation of arguments in shell commands shouldn't be done when arrays of arguments can be passed to functions that don't execute a shell such as `execFile`.
**Prevention:** Avoid `node:child_process` `exec` where possible, and use `execFile` or `spawn` instead where arguments are provided as separate strings and not evaluated as shell characters.
