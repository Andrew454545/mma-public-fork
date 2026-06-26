#!/usr/bin/env bash
set -euo pipefail

REPO="${GEONECTIONS_REPO:-Andrew454545/Geonections-}"
BRANCH="${GEONECTIONS_BRANCH:-main}"
TARGET_DIR="${GEONECTIONS_DIR:-$HOME/Documents/Geonections}"
REPO_URL="https://github.com/${REPO}.git"

info() {
	printf "\n%s\n" "$*"
}

fail() {
	printf "\nError: %s\n" "$*" >&2
	exit 1
}

if ! command -v git >/dev/null 2>&1; then
	fail "Git is required. Install Git, then run this setup command again."
fi

if ! command -v gh >/dev/null 2>&1; then
	cat >&2 <<'EOF'

Error: GitHub CLI is required.

Install it, then run this setup command again:
  macOS:   brew install gh
  Windows: winget install --id GitHub.cli
  Linux:   https://cli.github.com/
EOF
	exit 1
fi

if ! gh auth status -h github.com >/dev/null 2>&1; then
	info "Signing in to GitHub. Use the GitHub account that was invited to Geonections."
	gh auth login -h github.com -p https -w
fi

if ! gh repo view "$REPO" >/dev/null 2>&1; then
	fail "This GitHub account cannot access ${REPO}. Ask Andrew to invite your GitHub username, then run this again."
fi

mkdir -p "$(dirname "$TARGET_DIR")"

if [[ -d "$TARGET_DIR/.git" ]]; then
	info "Updating existing Geonections checkout at:"
	printf "%s\n" "$TARGET_DIR"
	git -C "$TARGET_DIR" remote set-url origin "$REPO_URL"
	git -C "$TARGET_DIR" fetch origin "$BRANCH"
	if git -C "$TARGET_DIR" rev-parse --verify "$BRANCH" >/dev/null 2>&1; then
		git -C "$TARGET_DIR" checkout "$BRANCH"
	else
		git -C "$TARGET_DIR" checkout -B "$BRANCH" "origin/$BRANCH"
	fi
	git -C "$TARGET_DIR" pull --ff-only origin "$BRANCH"
elif [[ -e "$TARGET_DIR" ]]; then
	fail "${TARGET_DIR} already exists but is not a Git checkout. Move it aside or set GEONECTIONS_DIR to another folder."
else
	info "Cloning Geonections to:"
	printf "%s\n" "$TARGET_DIR"
	gh repo clone "$REPO" "$TARGET_DIR" -- --branch "$BRANCH"
fi

JSON_COUNT="$(find "$TARGET_DIR" -type f -name '*.json' | wc -l | tr -d '[:space:]')"

info "Done."
printf "Geonections folder: %s\n" "$TARGET_DIR"
printf "JSON files found: %s\n" "$JSON_COUNT"
printf "Puzzle JSONs: %s\n" "$TARGET_DIR/ui/public/puzzles"

