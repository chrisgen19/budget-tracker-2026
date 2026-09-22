# Claude review plugin pin

The automatic review workflow installs Anthropic's `code-review` plugin through this local
marketplace. The marketplace is repository-owned, while the plugin source remains upstream and is
restricted to `plugins/code-review` at an exact 40-character commit SHA. This avoids copying
Anthropic's all-rights-reserved source into this repository and prevents an upstream branch change
from silently changing the code and prompts that run with the review credential.

Pinned upstream commit:
[`b486776a2eef0d3f39abaebaa3c03e378c7480b8`](https://github.com/anthropics/claude-code/tree/b486776a2eef0d3f39abaebaa3c03e378c7480b8/plugins/code-review)

## Updating the pin

Plugin updates are deliberate pull requests, not automatic runtime updates:

1. Resolve the current upstream `main` commit with
   `gh api repos/anthropics/claude-code/commits/main --jq .sha`.
2. Review every upstream change to `plugins/code-review` between the old and new commits. Include
   the comparison link and a short behavioral summary in the update PR.
3. Replace `source.sha` in `.claude-plugin/marketplace.json` and increment both the marketplace
   `version` and the plugin entry's `version`, even if Anthropic left its own manifest version
   unchanged. Claude Code uses the marketplace entry's version as the plugin-cache identity, so a
   SHA update without a version update can keep an older cached copy.
4. Run `claude plugin validate .claude/claude-review-marketplace`, then install it in an isolated
   Claude configuration and confirm it is reported as `code-review@budget-tracker-review-plugins`.
5. Run the repository checks and open a PR. Because the Claude action does not review changes to
   its own workflow or protected `.claude/` configuration, merge only after human review. Use the
   next ordinary application PR as the live test for subagent launch and review-comment posting.

Do not replace the SHA with `main`, a tag, or another mutable ref. If the plugin needs an urgent
upstream fix, advance the SHA through the same review process.
