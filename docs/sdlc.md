# Secure SDLC

## Branch and review policy

- All changes go through pull requests; direct pushes to `main` should remain blocked.
- Require at least one review for application changes and one infrastructure-aware review for Terraform/Firebase/CI changes.
- Keep changes scoped. Pair product changes with validation, docs, and rule updates where applicable.

## Definition of done

- Typecheck, lint, and test pass locally or in CI.
- JSON/YAML config files parse successfully.
- Terraform files are formatted with `terraform fmt` when Terraform is available.
- Security-sensitive changes include threat-model notes in the PR description.
- New secrets are documented as Secret Manager placeholders only; no secret values are committed.

## Threat modeling prompt

For changes touching auth, billing, user content, secrets, infrastructure, or external integrations, answer:

1. What data classes does this touch?
2. Who can call this path and how is authorization enforced?
3. What happens on replay, retry, timeout, or duplicate delivery?
4. What logs/metrics prove it works without exposing sensitive content?
5. How can credentials or provider failures be isolated and rotated?

## Release checklist

1. Confirm CI is green on the target commit.
2. Review dependency audit results and exceptions.
3. Confirm migrations and rollback notes.
4. Confirm runtime secrets are present in the target environment.
5. Deploy to staging first, smoke test, then promote to production.
6. Monitor error rate, latency, Pub/Sub dead letters, and billing events.

## Vulnerability management

- Critical dependency or credential issues: patch/rotate immediately.
- High severity issues: fix or mitigate within 7 days.
- Medium severity issues: fix within 30 days or document accepted risk.
- Low severity issues: prioritize in normal maintenance.
