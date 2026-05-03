# Local audio worker daemon

The non-cloud local audio worker can run continuously as a local daemon. It polls the JSON store used by the API/desktop local flow, processes all currently queued local-file audio jobs on each tick, then sleeps until the next poll.

## Run manually

From the repository root:

```sh
SONOLECT_LOCAL_STORE_PATH="$HOME/.local/share/sonolect/local-store.json" \
SONOLECT_LOCAL_STT_COMMAND='whisper-cpp -f {audioPath} -l {language}' \
npx --yes pnpm@9.15.0 --filter @sonolect/worker-service local:audio:daemon -- --interval-ms 5000
```

Configuration sources:

- `--store` or `--store-path`: JSON store path. Falls back to `SONOLECT_LOCAL_STORE_PATH`, then `SONOLECT_API_STORE_PATH`.
- `--interval-ms`: poll interval in milliseconds. Falls back to `SONOLECT_LOCAL_AUDIO_WORKER_INTERVAL_MS`, then `5000`.
- `--local-stt-command`: offline STT command template. Falls back to `SONOLECT_LOCAL_STT_COMMAND`.

The daemon writes JSON log lines for startup/config, each processing tick, and shutdown. It handles `SIGINT` and `SIGTERM` gracefully.

`SONOLECT_LOCAL_STT_COMMAND`/`--local-stt-command` may include these placeholders, which are shell-quoted before execution:

- `{audioPath}`
- `{mimeType}`
- `{language}`

## Example systemd user service

Save as `~/.config/systemd/user/sonolect-local-audio-worker.service` and adjust paths/commands for your machine:

```ini
[Unit]
Description=Sonolect local audio worker daemon
After=default.target

[Service]
Type=simple
WorkingDirectory=%h/src/sonolect
Environment=SONOLECT_LOCAL_STORE_PATH=%h/.local/share/sonolect/local-store.json
Environment=SONOLECT_LOCAL_AUDIO_WORKER_INTERVAL_MS=5000
Environment=SONOLECT_LOCAL_STT_COMMAND=whisper-cpp -f {audioPath} -l {language}
ExecStart=npx --yes pnpm@9.15.0 --filter @sonolect/worker-service local:audio:daemon
Restart=on-failure
RestartSec=5s

[Install]
WantedBy=default.target
```

Enable it:

```sh
systemctl --user daemon-reload
systemctl --user enable --now sonolect-local-audio-worker.service
journalctl --user -u sonolect-local-audio-worker.service -f
```
