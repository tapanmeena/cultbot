#!/usr/bin/env bash
#
# CultBot setup helper for a Raspberry Pi / Linux server.
#
# What it does:
#   1. Checks that Node 18+ and pnpm are available.
#   2. Installs dependencies (pnpm install --frozen-lockfile).
#   3. Creates .env from .env.example (chmod 600) if it does not exist.
#   4. Optionally installs and enables the systemd timer (Option B), filling in
#      this machine's user, path, and node binary.
#
# Usage:
#   ./scripts/setup-pi.sh                 # steps 1-3, then prompt for step 4
#   ./scripts/setup-pi.sh --with-systemd  # also install the timer (uses sudo)
#   ./scripts/setup-pi.sh --no-systemd    # skip the timer entirely
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${REPO_DIR}"

info() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33mwarning:\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31merror:\033[0m %s\n' "$*" >&2; exit 1; }

WITH_SYSTEMD=""
for arg in "$@"; do
  case "${arg}" in
    --with-systemd) WITH_SYSTEMD="yes" ;;
    --no-systemd)   WITH_SYSTEMD="no" ;;
    -h|--help)      grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *)              die "Unknown option: ${arg} (try --help)" ;;
  esac
done

# --- 1. Node ---
command -v node >/dev/null 2>&1 || die "Node.js is not installed. Install Node 18+ (LTS 20/22) first."
NODE_BIN="$(command -v node)"
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "${NODE_MAJOR}" -ge 18 ] || die "Node ${NODE_MAJOR} is too old. CultBot needs Node 18 or newer."
info "Node $(node -v) at ${NODE_BIN}"

# --- pnpm ---
if ! command -v pnpm >/dev/null 2>&1; then
  warn "pnpm not found; trying to enable it via corepack..."
  if command -v corepack >/dev/null 2>&1; then
    corepack enable >/dev/null 2>&1 || true
    corepack prepare pnpm@latest --activate >/dev/null 2>&1 || true
  fi
fi
command -v pnpm >/dev/null 2>&1 || die "pnpm is not available. Install it with: npm install -g pnpm"
info "pnpm $(pnpm -v)"

# --- 2. dependencies ---
info "Installing dependencies..."
pnpm install --frozen-lockfile

# --- 3. .env ---
if [ -f .env ]; then
  info ".env already exists - leaving it untouched."
else
  cp .env.example .env
  chmod 600 .env
  info "Created .env from .env.example (chmod 600). Edit it before your first run:"
  info "  nano ${REPO_DIR}/.env"
fi

# --- 4. systemd timer (optional) ---
install_systemd() {
  command -v systemctl >/dev/null 2>&1 || die "systemctl not found; not a systemd host. Use cron instead (deploy/crontab.example)."

  local target_user tmp_service tmp_timer
  target_user="${SUDO_USER:-$(id -un)}"
  tmp_service="$(mktemp)"
  tmp_timer="$(mktemp)"

  # Fill placeholders in the template with this machine's real values.
  sed \
    -e "s|^User=.*|User=${target_user}|" \
    -e "s|^WorkingDirectory=.*|WorkingDirectory=${REPO_DIR}|" \
    -e "s|^ExecStart=.*|ExecStart=${NODE_BIN} index.js book|" \
    deploy/cultbot.service > "${tmp_service}"
  cp deploy/cultbot.timer "${tmp_timer}"

  info "Installing systemd units (requires sudo)..."
  sudo cp "${tmp_service}" /etc/systemd/system/cultbot.service
  sudo cp "${tmp_timer}"   /etc/systemd/system/cultbot.timer
  rm -f "${tmp_service}" "${tmp_timer}"

  sudo systemctl daemon-reload
  sudo systemctl enable --now cultbot.timer

  info "Timer installed. Useful commands:"
  info "  systemctl list-timers cultbot.timer   # next scheduled run"
  info "  sudo systemctl start cultbot.service  # run once now"
  info "  journalctl -u cultbot.service -f      # follow logs"
  warn "Set your schedule in /etc/systemd/system/cultbot.timer (OnCalendar=), then: sudo systemctl daemon-reload"
}

if [ "${WITH_SYSTEMD}" = "yes" ]; then
  install_systemd
elif [ "${WITH_SYSTEMD}" = "no" ]; then
  info "Skipping systemd. To schedule with cron instead, see deploy/crontab.example."
elif command -v systemctl >/dev/null 2>&1; then
  printf 'Install and enable the systemd timer now? [y/N] '
  read -r reply || reply=""
  case "${reply}" in
    [yY] | [yY][eE][sS]) install_systemd ;;
    *) info "Skipped. Re-run with --with-systemd later, or use cron (deploy/crontab.example)." ;;
  esac
else
  info "No systemd detected. Schedule with cron (deploy/crontab.example) or Docker (docker-compose.yml)."
fi

info "Done. Test a dry run with:  node index.js book --dry-run"
