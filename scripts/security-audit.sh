#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────
# Sonolect — Local Security Audit Script
#
# Runs all security checks locally and produces a summary report.
# Exit code 1 if any critical issues are found.
#
# Usage:
#   ./scripts/security-audit.sh          # Run all checks
#   ./scripts/security-audit.sh --quick  # Skip slow checks (container scan)
# ──────────────────────────────────────────────────────────────────────
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "${REPO_ROOT}"

QUICK=false
if [[ "${1:-}" == "--quick" ]]; then
  QUICK=true
fi

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

PASSED=0
WARNED=0
FAILED=0

summary_lines=()

check_pass() {
  PASSED=$((PASSED + 1))
  summary_lines+=("${GREEN}PASS${NC}  $1")
  echo -e "  ${GREEN}PASS${NC}  $1"
}

check_warn() {
  WARNED=$((WARNED + 1))
  summary_lines+=("${YELLOW}WARN${NC}  $1")
  echo -e "  ${YELLOW}WARN${NC}  $1"
}

check_fail() {
  FAILED=$((FAILED + 1))
  summary_lines+=("${RED}FAIL${NC}  $1")
  echo -e "  ${RED}FAIL${NC}  $1"
}

echo ""
echo -e "${CYAN}╔══════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║         Sonolect Security Audit                     ║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════════════════════╝${NC}"
echo ""

# ── 1. Secret scanning (gitleaks) ────────────────────────────────────
echo -e "${CYAN}[1/6] Secret scanning (gitleaks)${NC}"
if command -v gitleaks &>/dev/null; then
  if gitleaks detect --source "${REPO_ROOT}" --config "${REPO_ROOT}/.gitleaks.toml" --no-git 2>/dev/null; then
    check_pass "No secrets detected"
  else
    check_fail "Secrets detected — run 'gitleaks detect --verbose' for details"
  fi
else
  check_warn "gitleaks not installed — install from https://github.com/gitleaks/gitleaks"
fi

# ── 2. Dependency audit (pnpm audit) ────────────────────────────────
echo -e "${CYAN}[2/6] Dependency audit (pnpm audit)${NC}"
if command -v pnpm &>/dev/null; then
  audit_output=$(pnpm audit --audit-level moderate 2>&1) || true
  if echo "${audit_output}" | grep -qi "critical\|high"; then
    check_fail "Critical/high vulnerabilities found in dependencies"
    echo "       Run 'pnpm audit' for full details"
  elif echo "${audit_output}" | grep -qi "moderate"; then
    check_warn "Moderate vulnerabilities found in dependencies"
  else
    check_pass "No critical dependency vulnerabilities"
  fi
else
  check_warn "pnpm not found — skipping dependency audit"
fi

# ── 3. License compliance ────────────────────────────────────────────
echo -e "${CYAN}[3/6] License compliance${NC}"
if command -v npx &>/dev/null; then
  COPYLEFT="GPL-2.0-only;GPL-3.0-only;GPL-3.0-or-later;AGPL-1.0-only;AGPL-3.0-only;AGPL-3.0-or-later;SSPL-1.0"
  if npx --yes license-checker-rsync-3 --production --failOn "${COPYLEFT}" --summary 2>/dev/null; then
    check_pass "No copyleft / incompatible licenses detected"
  else
    check_fail "Copyleft or incompatible licenses found"
  fi
else
  check_warn "npx not available — skipping license check"
fi

# ── 4. Sensitive files check ─────────────────────────────────────────
echo -e "${CYAN}[4/6] Sensitive files check${NC}"
sensitive_found=false
for pattern in ".env" ".env.local" ".env.production" "*.pem" "*.key" "credentials.json" "service-account*.json"; do
  # Search tracked files only (or all files if not a git repo)
  if git ls-files --error-unmatch "${pattern}" 2>/dev/null | head -1 | grep -q .; then
    echo "       Found tracked sensitive file matching: ${pattern}"
    sensitive_found=true
  fi
done

if [[ "${sensitive_found}" == "true" ]]; then
  check_fail "Sensitive files are tracked in git"
else
  check_pass "No sensitive files tracked in git"
fi

# ── 5. Container scanning (Trivy) ───────────────────────────────────
echo -e "${CYAN}[5/6] Container scanning (Trivy)${NC}"
if [[ "${QUICK}" == "true" ]]; then
  check_warn "Skipped (--quick mode)"
elif command -v trivy &>/dev/null; then
  container_issues=false
  for dockerfile in services/*/Dockerfile; do
    if [[ -f "${dockerfile}" ]]; then
      service_name=$(basename "$(dirname "${dockerfile}")")
      if ! trivy config "${dockerfile}" --severity CRITICAL,HIGH --exit-code 1 2>/dev/null; then
        echo "       Issues in ${service_name}/Dockerfile"
        container_issues=true
      fi
    fi
  done
  if [[ "${container_issues}" == "true" ]]; then
    check_fail "Dockerfile security issues found"
  else
    check_pass "Dockerfiles passed security scan"
  fi
else
  check_warn "Trivy not installed — install from https://github.com/aquasecurity/trivy"
fi

# ── 6. OSV-Scanner (known CVEs) ─────────────────────────────────────
echo -e "${CYAN}[6/6] OSV-Scanner (known CVEs)${NC}"
if command -v osv-scanner &>/dev/null; then
  if osv-scanner --lockfile "${REPO_ROOT}/pnpm-lock.yaml" 2>/dev/null; then
    check_pass "No known CVEs via OSV-Scanner"
  else
    check_warn "OSV-Scanner found potential issues — review output above"
  fi
else
  check_warn "osv-scanner not installed — install from https://github.com/google/osv-scanner"
fi

# ── Summary ──────────────────────────────────────────────────────────
echo ""
echo -e "${CYAN}──────────────────────────────────────────────────────${NC}"
echo -e "${CYAN}Summary${NC}"
echo -e "  ${GREEN}Passed:${NC}  ${PASSED}"
echo -e "  ${YELLOW}Warned:${NC}  ${WARNED}"
echo -e "  ${RED}Failed:${NC}  ${FAILED}"
echo -e "${CYAN}──────────────────────────────────────────────────────${NC}"
echo ""

if [[ "${FAILED}" -gt 0 ]]; then
  echo -e "${RED}Security audit FAILED — ${FAILED} critical issue(s) found.${NC}"
  exit 1
else
  echo -e "${GREEN}Security audit passed (${WARNED} warning(s)).${NC}"
  exit 0
fi
