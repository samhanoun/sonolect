# Security Policy

## Reporting a vulnerability

Please report vulnerabilities privately through
[GitHub Security Advisories](https://github.com/samhanoun/sonolect/security/advisories/new).
Do not open a public issue.

Include the affected component (desktop app, web, mobile, a service under
`services/`, or infrastructure), steps to reproduce, and the impact you observed.
We aim to acknowledge reports within 3 business days and to share a fix
timeline after triage, following the targets in [docs/sdlc.md](docs/sdlc.md#vulnerability-management).

## Supported versions

Only the latest release and the `main` branch receive security fixes.

## Automated scanning

Every pull request and push to `main` runs:

| Check      | Tool                         | What it covers                                                                                                                                            |
| ---------- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SAST       | CodeQL (`security-extended`) | TypeScript/JavaScript, Rust, GitHub Actions                                                                                                               |
| SAST / IaC | Semgrep                      | Code, Dockerfiles, Terraform, workflows; fails on ERROR findings                                                                                          |
| SCA        | OSV-Scanner                  | `pnpm-lock.yaml` and `Cargo.lock`, results in code scanning                                                                                               |
| SCA        | `pnpm audit`, `cargo audit`  | Fails on high/critical npm advisories in every workspace, mobile too (accepted exceptions in `scripts/audit-gate.mjs`) and any RustSec vulnerability      |
| SCA        | Dependency Review            | Blocks PRs adding high-severity or copyleft-licensed dependencies (enable with repo variable `ENABLE_DEPENDENCY_REVIEW=true` once Dependency graph is on) |
| Secrets    | Gitleaks                     | Full git history (CI workflow, `security` job)                                                                                                            |
| Posture    | OpenSSF Scorecard            | Weekly, on `main`                                                                                                                                         |

CodeQL and Scorecard run once code scanning is enabled for the repository
(Settings > Code security; private repositories need GitHub Code Security) and
the repository variable `ENABLE_CODE_SCANNING` is set to `true`. Until then,
Semgrep and OSV-Scanner still run and gate, and their SARIF reports are kept as
workflow artifacts.

Dependabot opens weekly update PRs for npm, Cargo, GitHub Actions, Docker base
images and Terraform providers.
