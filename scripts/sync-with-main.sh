#!/usr/bin/env bash
set -euo pipefail

REMOTE="${1:-origin}"
BASE_BRANCH="${2:-main}"
MODE="${3:-rebase}" # rebase | merge

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "[error] Not inside a git repository"
  exit 1
fi

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "[error] Working tree is not clean. Commit/stash first."
  git status --short
  exit 1
fi

if ! git remote get-url "$REMOTE" >/dev/null 2>&1; then
  echo "[error] Remote '$REMOTE' not found."
  echo "Example: git remote add origin <repo-url>"
  exit 1
fi

CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
echo "[info] Branch: ${CURRENT_BRANCH}"
echo "[info] Fetching ${REMOTE}/${BASE_BRANCH} ..."
if ! git fetch "$REMOTE" "$BASE_BRANCH"; then
  echo "[error] Failed to fetch ${REMOTE}/${BASE_BRANCH}."
  echo "Check network/auth/proxy, then retry."
  exit 1
fi

if [[ "$MODE" == "merge" ]]; then
  echo "[info] Merging ${REMOTE}/${BASE_BRANCH} into ${CURRENT_BRANCH} ..."
  set +e
  git merge --no-ff "${REMOTE}/${BASE_BRANCH}"
  rc=$?
  set -e
else
  echo "[info] Rebasing ${CURRENT_BRANCH} onto ${REMOTE}/${BASE_BRANCH} ..."
  set +e
  git rebase "${REMOTE}/${BASE_BRANCH}"
  rc=$?
  set -e
fi

if [[ $rc -ne 0 ]]; then
  echo "[warn] Conflicts detected. Resolve files below, then continue:"
  git diff --name-only --diff-filter=U || true
  if [[ "$MODE" == "merge" ]]; then
    echo "Run: git add <files> && git commit"
  else
    echo "Run: git add <files> && git rebase --continue"
  fi
  exit $rc
fi

echo "[ok] Sync completed without conflicts."
git status --short --branch
