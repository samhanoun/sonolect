# Contributing

Thanks for contributing to Sonolect.

## Local setup

Use the repository-pinned pnpm version:

```bash
npx --yes pnpm@9.15.0 install
```

Common commands:

```bash
npx --yes pnpm@9.15.0 typecheck
npx --yes pnpm@9.15.0 lint
npx --yes pnpm@9.15.0 test
npx --yes pnpm@9.15.0 format:check
```

## Working with existing changes

This repository may have parallel work in progress. Before editing shared files, inspect current contents and `git status --short`. Do not overwrite unrelated uncommitted changes.

## Security expectations

- Do not commit secrets, credentials, private keys, tokens, or production data.
- Put new secret names in Terraform/Docs only as placeholders; add secret values out-of-band.
- Update Firebase rules with any new tenant/user data paths.
- Prefer least-privilege IAM and dedicated service accounts.

## Pull request checklist

- [ ] Scope is focused and described clearly.
- [ ] Typecheck/lint/test pass or failures are explained.
- [ ] Docs are updated for user-visible, operational, or security-sensitive changes.
- [ ] Infrastructure changes include rollback notes and environment impact.
