## Summary

<!-- What changes and why. Link the issue if there is one. -->

## Type of change

- [ ] Feature
- [ ] Bug fix
- [ ] Refactor / chore
- [ ] Security fix
- [ ] Infrastructure / CI

## How it was tested

<!-- Commands run, manual checks, screenshots for UI changes. -->

## Security and privacy

<!-- Required for changes touching auth, billing, user content (audio, transcripts),
secrets, infrastructure, or external integrations. See docs/sdlc.md#threat-modeling-prompt. -->

- [ ] No secrets, tokens or production data are committed
- [ ] New inputs are validated and authorization is enforced server-side
- [ ] New dependencies were reviewed (licence, maintenance, advisories)

## Checklist

- [ ] Typecheck, lint and tests pass (`pnpm typecheck && pnpm lint && pnpm test`)
- [ ] Security workflows (CodeQL, Semgrep, OSV, audit, gitleaks) are green or findings are triaged
- [ ] Docs updated for user-visible, operational or security-sensitive changes
- [ ] Infrastructure changes include rollback notes and environment impact
