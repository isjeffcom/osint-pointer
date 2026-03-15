#!/usr/bin/env bash
set -euo pipefail

DEFAULT_REMOTE="${1:-origin}"
DEFAULT_BRANCH="${2:-main}"

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "Not inside a git repository"
  exit 1
fi

if ! git remote get-url "$DEFAULT_REMOTE" >/dev/null 2>&1; then
  echo "Remote '$DEFAULT_REMOTE' not found. Add remote first, e.g.:"
  echo "  git remote add origin <repo-url>"
  exit 1
fi

echo "Fetching $DEFAULT_REMOTE/$DEFAULT_BRANCH ..."
git fetch "$DEFAULT_REMOTE" "$DEFAULT_BRANCH"

echo "Rebasing current branch onto $DEFAULT_REMOTE/$DEFAULT_BRANCH ..."
git rebase "$DEFAULT_REMOTE/$DEFAULT_BRANCH"

echo "Done. Current status:"
git status --short --branch
