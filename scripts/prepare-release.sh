#!/usr/bin/env bash
set -euo pipefail

# ── prepare-release.sh ─────────────────────────────────────────────────
# Validates the repo, bumps version, updates CHANGELOG, tags, and pushes.
# Usage: ./scripts/prepare-release.sh <version>
# Example: ./scripts/prepare-release.sh 1.0.0

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info()  { echo -e "${GREEN}[info]${NC}  $*"; }
warn()  { echo -e "${YELLOW}[warn]${NC}  $*"; }
error() { echo -e "${RED}[error]${NC} $*" >&2; }
die()   { error "$@"; exit 1; }

# ── Validate arguments ─────────────────────────────────────────────────
VERSION="${1:-}"
if [ -z "$VERSION" ]; then
  die "Usage: $0 <version>  (e.g. 1.0.0, 1.2.0-beta.1)"
fi

# Strip leading 'v' if provided
VERSION="${VERSION#v}"

# Validate semver-ish format
if ! echo "$VERSION" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.]+)?$'; then
  die "Invalid version format: $VERSION (expected semver, e.g. 1.0.0 or 1.0.0-beta.1)"
fi

TAG="v${VERSION}"

# ── Validate branch ───────────────────────────────────────────────────
BRANCH=$(git branch --show-current)
if [ "$BRANCH" != "main" ]; then
  die "Releases must be cut from 'main'. Current branch: $BRANCH"
fi

# ── Check working tree is clean ────────────────────────────────────────
if ! git diff --quiet || ! git diff --cached --quiet; then
  die "Working tree is dirty. Commit or stash changes before releasing."
fi

# ── Check tag does not already exist ───────────────────────────────────
if git rev-parse "$TAG" >/dev/null 2>&1; then
  die "Tag $TAG already exists."
fi

# ── Run full test suite ────────────────────────────────────────────────
info "Running full test suite..."
pnpm test
pnpm typecheck
pnpm lint
info "All checks passed."

# ── Bump version in package.json files ─────────────────────────────────
info "Bumping version to $VERSION..."

ROOT_DIR="$(git rev-parse --show-toplevel)"

# Root package.json
node -e "
  const fs = require('fs');
  const path = '$ROOT_DIR/package.json';
  const pkg = JSON.parse(fs.readFileSync(path, 'utf8'));
  pkg.version = '$VERSION';
  fs.writeFileSync(path, JSON.stringify(pkg, null, 2) + '\n');
  console.log('  Updated', path);
"

# Desktop package.json
node -e "
  const fs = require('fs');
  const path = '$ROOT_DIR/apps/desktop/package.json';
  const pkg = JSON.parse(fs.readFileSync(path, 'utf8'));
  pkg.version = '$VERSION';
  fs.writeFileSync(path, JSON.stringify(pkg, null, 2) + '\n');
  console.log('  Updated', path);
"

# Tauri config
node -e "
  const fs = require('fs');
  const path = '$ROOT_DIR/apps/desktop/src-tauri/tauri.conf.json';
  const cfg = JSON.parse(fs.readFileSync(path, 'utf8'));
  cfg.version = '$VERSION';
  fs.writeFileSync(path, JSON.stringify(cfg, null, 2) + '\n');
  console.log('  Updated', path);
"

# Cargo.toml
sed -i "s/^version = \".*\"/version = \"$VERSION\"/" "$ROOT_DIR/apps/desktop/src-tauri/Cargo.toml"
info "  Updated Cargo.toml"

# ── Update CHANGELOG.md ───────────────────────────────────────────────
info "Updating CHANGELOG.md..."
CHANGELOG="$ROOT_DIR/CHANGELOG.md"

PREVIOUS_TAG=$(git tag --sort=-creatordate | grep '^v' | head -1 || echo "")
if [ -n "$PREVIOUS_TAG" ]; then
  LOG=$(git log "${PREVIOUS_TAG}..HEAD" --pretty=format:"- %s (%h)" --no-merges)
else
  LOG=$(git log --pretty=format:"- %s (%h)" --no-merges -30)
fi

DATE=$(date +%Y-%m-%d)
ENTRY="## [$VERSION] - $DATE

$LOG
"

if [ -f "$CHANGELOG" ]; then
  # Insert new entry after the first heading line
  EXISTING=$(cat "$CHANGELOG")
  echo -e "# Changelog\n\n${ENTRY}\n${EXISTING#*$'\n'}" > "$CHANGELOG"
else
  echo -e "# Changelog\n\n${ENTRY}" > "$CHANGELOG"
fi

info "  CHANGELOG.md updated."

# ── Commit and tag ─────────────────────────────────────────────────────
info "Committing version bump..."
git add \
  "$ROOT_DIR/package.json" \
  "$ROOT_DIR/apps/desktop/package.json" \
  "$ROOT_DIR/apps/desktop/src-tauri/tauri.conf.json" \
  "$ROOT_DIR/apps/desktop/src-tauri/Cargo.toml" \
  "$CHANGELOG"

git commit -m "chore: release $TAG"
git tag -a "$TAG" -m "Release $TAG"

info "Pushing to origin..."
git push origin main
git push origin "$TAG"

# ── Done ───────────────────────────────────────────────────────────────
echo ""
info "Release $TAG is ready!"
echo ""
echo "  Next steps:"
echo "    1. GitHub Actions will build desktop binaries for all platforms."
echo "    2. A GitHub Release with attached artifacts will be created automatically."
echo "    3. The Tauri updater manifest (latest.json) will be uploaded to the release."
echo "    4. Existing desktop installations will auto-update on next launch."
echo ""
echo "  Monitor the release workflow:"
echo "    https://github.com/$(git remote get-url origin | sed 's/.*github.com[:/]\(.*\)\.git/\1/')/actions"
echo ""
