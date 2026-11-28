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
# In CI this runs from `main`, never from the PR (see `redesign-scope.yml`), so a PR cannot
# change the rules it is judged by.
#
# Usage: check-redesign-scope.sh <base-ref> <head-ref>
# Run locally with: .github/scripts/check-redesign-scope.sh origin/main HEAD

set -euo pipefail

base="${1:?base ref required}"
head="${2:?head ref required}"

# Backend by location. `validations.ts` is listed because its Zod schemas are what the API routes
# accept: a form tweak there changes the contract for every client, not only this one.
# `.github/` is listed so a redesign PR that edits CI is reported for it.
#
# Both build-pack files are listed, not just the one Coolify happens to be set to. They hold the
# production build command, the production Node version and the runtime apt list, and a redesign
# branch that changed one of them would otherwise be reported as "none of them backend" and
# reviewed as visual work.
STATIC_PATTERN='^(src/app/api/|prisma/|mcp-server/|src/lib/(mcp|telegram)/|\.github/)|^src/(middleware|instrumentation)\.ts$|^src/lib/validations\.ts$|^(nixpacks\.toml|railpack\.json|Dockerfile|\.dockerignore)$'

# Backend by content, for `src/lib` modules. A fixed list of file names would go stale the first
# time a new `*-writes.ts` or query module was added; these rules follow the code instead.
#
# Reaches the database: imports the Prisma *client* in either quote style, by alias or relative
# path. `@prisma/client` is deliberately not matched, since UI-safe modules import its types.
DB_PATTERN='from ["'\''](@/lib/prisma|(\.\.?/)+(lib/)?prisma)["'\'']|PrismaClient|queryRaw|prisma\.\$transaction'

# Server-only without touching the database: request and session handling, auth, email, AI and
# Node built-ins, or a module built on one of the app's server-only helpers. This is what catches
# `session.ts` (`getAuthUserId`, `requireAdmin`), where a change rewrites API access control.
SERVER_PATTERN='from ["'\''](next/server|next/headers|next-auth(/[^"'\'']*)?|resend|@google/genai|bcryptjs|node:[a-z_]+)["'\'']|from ["'\''](@/lib/|\.\.?/)(session|auth|email|gemini|prisma)["'\'']'

is_server_module() {
  local path="$1" content
  # Either side counts: a file that was server code before this change is still a backend file
  # if the change removed that, and a deleted file exists only in the base.
  content="$({ git show "$head:$path" 2>/dev/null; git show "$base:$path" 2>/dev/null; } || true)"
  grep -qE "$DB_PATTERN|$SERVER_PATTERN" <<<"$content"
}

# Written to a file rather than read through a process substitution: `set -e` cannot see a failed
# producer behind `< <(...)`, so a missing base ref used to yield an empty list and a pass.
# `-z` keeps paths verbatim: without it Git quotes and escapes unusual ones (`"src/app/api/caf\303\251/..."`),
# and the leading quote would slip past both patterns. `--no-renames` lists a move as a delete
# plus an add, so moving a file out of `src/app/api/` still reports the path it left.
changed_list="$(mktemp)"
trap 'rm -f "$changed_list"' EXIT
git diff --name-only -z --no-renames "$base...$head" >"$changed_list"
mapfile -d '' -t changed <"$changed_list"

blocked=()
for path in "${changed[@]}"; do
  [[ -z "$path" ]] && continue
  if [[ "$path" =~ $STATIC_PATTERN ]]; then
    blocked+=("$path")
  elif [[ "$path" == src/lib/*.ts ]] && is_server_module "$path"; then
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
