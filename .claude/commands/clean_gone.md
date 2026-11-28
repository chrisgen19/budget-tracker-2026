---
description: Delete local branches whose upstream is gone (merged or deleted on the remote), removing any attached worktree first.
---

## Your Task

Delete local branches whose upstream has been deleted on the remote, after confirming each one's work is safe to lose.

This is a corrected copy of the `commit-commands` plugin's `/commit-commands:clean_gone`. That
version silently does nothing: `git branch -v` does not print upstream tracking info at all, and
git writes the marker as `[origin/<branch>: gone]`, so its `grep '\[gone\]'` never matches. Prefer
this command over the plugin one.

## Commands to Execute

1. **Refresh the remote-tracking refs first.** A branch is only marked gone once the deleted
   remote ref has been pruned locally, so without this the list is stale:
   ```bash
   git fetch --prune
   ```

2. **List branches with their upstream status.** `-vv` is required: `-v` omits the upstream
   column, so no branch ever appears gone:
   ```bash
   git branch -vv
   ```

   A `+` prefix means the branch is checked out in a worktree, which must be removed before the
   branch can be deleted. A `*` prefix is the current branch.

3. **List worktrees:**
   ```bash
   git worktree list
   ```

4. **Check each gone branch for unmerged work BEFORE deleting anything.** `git branch -D` is a
   force delete and will discard commits:
   ```bash
   git branch -vv | grep ': gone]' | sed 's/^[+*] *//' | awk '{print $1}' | while read -r branch; do
     echo "== $branch"
     git log --oneline "main..$branch"
   done
   ```

   Commits listed here are **not** proof of lost work: a squash-merged or rebase-merged PR
   relands the content under a new SHA, so the original commits are never ancestors of `main`
   even though the work shipped. For any branch that lists commits, confirm where it went before
   deleting:
   ```bash
   gh pr list --state all --head <branch> --json number,state,mergedAt,mergeCommit,url
   ```

   - PR merged → safe to delete (the content is in `main` under the squash/merge commit).
   - No PR, or PR closed unmerged → **stop and ask the user.** Those commits exist only here.

5. **Remove worktrees and delete the gone branches:**
   ```bash
   git branch -vv | grep ': gone]' | sed 's/^[+*] *//' | awk '{print $1}' | while read -r branch; do
     echo "Processing branch: $branch"
     worktree=$(git worktree list | grep "\[$branch\]" | awk '{print $1}')
     if [ -n "$worktree" ] && [ "$worktree" != "$(git rev-parse --show-toplevel)" ]; then
       echo "  Removing worktree: $worktree"
       git worktree remove --force "$worktree"
     else
       echo "  No worktree attached"
     fi
     echo "  Deleting branch: $branch"
     git branch -D "$branch"
   done
   ```

   Note the grep is `': gone]'`, matching git's actual `[origin/<branch>: gone]` output, and the
   sed strips a leading `+` or `*` plus the following spaces so the branch name parses cleanly.

## Expected Behavior

- Branches whose remote was deleted are listed, checked for unmerged work, and removed.
- Any worktree holding one of them is removed first; the current worktree is never removed.
- Report which worktrees and branches were deleted, and name any branch skipped for review.

If no branch shows `: gone]`, report that no cleanup was needed.

## Recovery

A deleted branch is recoverable from the reflog for ~90 days:

```bash
git branch <branch> <sha>
```

Print each deleted branch's SHA (`git branch -D` echoes `was <sha>`) so the user can undo.
