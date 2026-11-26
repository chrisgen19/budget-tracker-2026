#!/usr/bin/env bash
#
# Fail when a redesign branch changes backend code.
#
# A redesign is UI work: pages, components, hooks, styles. When one quietly changes an API route,
# a write path or the schema to suit the new screens, every other client (MCP, the Telegram bot,
# the Mini App, a future mobile app) inherits that change through a PR that was reviewed as a
# visual one. The fix is not to forbid the backend change but to make it its own PR, reviewed as
# what it is, merged first, and then used by the redesign.
#
# Usage: check-redesign-scope.sh <base-sha> <head-sha>
# Run locally with: .github/scripts/check-redesign-scope.sh origin/main HEAD

set -euo pipefail

base="${1:?base ref required}"
head="${2:?head ref required}"

# Backend by location. `validations.ts` is listed because its Zod schemas are what the API routes
# accept: a form tweak there changes the contract for every client, not only this one.
# `.github/` is listed so a redesign branch cannot switch this check off in the same PR.
STATIC_PATTERN='^(src/app/api/|prisma/|mcp-server/|src/lib/(mcp|telegram)/|\.github/)|^src/(middleware|instrumentation)\.ts$|^src/lib/validations\.ts$|^nixpacks\.toml$'

# Backend by content: any `src/lib` module that reaches the database. A fixed list of file names
# would go stale the first time a new `*-writes.ts` or query module was added; this rule follows
# the code instead.
DB_PATTERN='from "@/lib/prisma"|PrismaClient|queryRaw|prisma\.\$transaction'

touches_db() {
  local path="$1" content
  # Either side counts: a file that used the database before this change is still a backend file
  # if the change removed that, and a deleted file exists only in the base.
  content="$({ git show "$head:$path" 2>/dev/null; git show "$base:$path" 2>/dev/null; } || true)"
  grep -qE "$DB_PATTERN" <<<"$content"
}

# `--no-renames` lists a move as a delete plus an add, so moving a file out of `src/app/api/`
# still reports the path it left.
mapfile -t changed < <(git diff --name-only --no-renames "$base...$head")

blocked=()
for path in "${changed[@]}"; do
  [[ -z "$path" ]] && continue
  if [[ "$path" =~ $STATIC_PATTERN ]]; then
    blocked+=("$path")
  elif [[ "$path" == src/lib/*.ts ]] && touches_db "$path"; then
    blocked+=("$path")
  fi
done

if ((${#blocked[@]} == 0)); then
  echo "Redesign scope OK: ${#changed[@]} changed file(s), none of them backend."
  exit 0
fi

echo "This redesign branch changes ${#blocked[@]} backend file(s):"
for path in "${blocked[@]}"; do
  echo "  $path"
  # Annotates the file on the PR's Files tab when run in GitHub Actions; plain text elsewhere.
  [[ -n "${GITHUB_ACTIONS:-}" ]] && echo "::error file=$path::Backend file changed on a redesign branch"
done
echo
echo "Move these changes into their own PR (feature/* or bugfix/*), merge it first, then rebase"
echo "this branch on main. The redesign should only consume the API, not change it."
exit 1
