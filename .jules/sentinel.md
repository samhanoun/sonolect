## 2024-11-09 - [Command Injection in worker-service]
**Vulnerability:** Command Injection in `runLocalSttCommand` using `exec`.
**Learning:** Using `exec` to run local STT command template where `shellQuote` may be bypassed.
**Prevention:** Remove `exec` and strictly use `execFile` via `SONOLECT_LOCAL_STT_COMMAND_ARGS` instead of `SONOLECT_LOCAL_STT_COMMAND` string.
