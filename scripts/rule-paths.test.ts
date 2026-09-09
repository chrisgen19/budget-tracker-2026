// @vitest-environment node
/**
 * Pins the two properties that make `.claude/rules/` worth having, and the one that lets any
 * other tool find it.
 *
 * `.claude/CLAUDE.md` imports `AGENTS.md`, so whatever stays there is injected before the first
 * prompt of every session. The area-specific material lives in `.claude/rules/`, where a file
 * carrying a `paths:` frontmatter key is held back and injected only when a matching file is
 * touched. Both halves of that are silent when they break:
 *
 * - A rule file with no `paths:` loads eagerly, exactly like CLAUDE.md. Nothing is wrong with its
 *   content, nothing errors, and the context cost the split removed simply comes back.
 * - A pattern that matches nothing, after the file it names is renamed or deleted, stops
 *   delivering its rule where the rule applies. Again nothing errors. The guidance just stops
 *   arriving, which from the inside is indistinguishable from there never having been any.
 *
 * Four rounds of review on the splitting PR found eighteen instances of the second shape by hand,
 * one of which the author had already dismissed as noise. That is the argument for asserting it
 * rather than trusting it.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = join(__dirname, "..");
const RULES_DIR = join(ROOT, ".claude", "rules");

/** Directories a repo-wide walk must not descend into. None of them is ever a `paths:` target. */
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".next",
  "dist",
  "coverage",
  "test-results",
  ".playwright-mcp",
]);

const ruleFiles = readdirSync(RULES_DIR)
  .filter((name) => name.endsWith(".md"))
  .sort();

/**
 * The `paths:` entries of one rule file, or `null` when it declares no such key.
 *
 * `null` and `[]` mean different things and the distinction is the point: a missing key makes the
 * file eager, while an empty list is a rule that can never load. Both are bugs, and they are kept
 * apart so the failure message can name the right one.
 */
const readPaths = (name: string): string[] | null => {
  const lines = readFileSync(join(RULES_DIR, name), "utf8").split("\n");
  if (lines[0] !== "---") return null;
  const end = lines.indexOf("---", 1);
  if (end === -1) return null;

  const frontmatter = lines.slice(1, end);
  if (!frontmatter.some((line) => /^paths:\s*$/.test(line))) return null;

  return frontmatter
    .filter((line) => /^\s+-\s/.test(line))
    .map((line) => line.replace(/^\s+-\s+/, "").trim().replace(/^["']|["']$/g, ""));
};

const walk = (dir: string, out: string[] = []): string[] => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    if (entry.name.startsWith(".") && entry.name !== ".claude" && entry.name !== ".github") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(relative(ROOT, full).split(sep).join("/"));
  }
  return out;
};

const allFiles = walk(ROOT);

/** A `**` segment crosses directory boundaries; a lone `*` stays inside one segment. */
const globToRegExp = (pattern: string): RegExp => {
  const source = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .split("**/")
    .map((part) => part.replace(/\*/g, "[^/]*"))
    .join("(?:.*/)?");
  return new RegExp(`^${source}$`);
};

/**
 * A bare directory matches everything beneath it, so `src/app/api` is a live trigger for
 * `src/app/api/health/route.ts` and a trailing `/**` adds nothing to it. That decides whether
 * most of these rules load at all, since 31 of the patterns are bare directories,
 * `src/lib/telegram` and `src/lib/mcp` among them, so it was checked against the running binary
 * rather than assumed: with `api-routes.md` scoped to `src/app/api` and nothing else, a session
 * that read the health route quoted a route description appearing nowhere under `src/`, and a
 * session that read nothing answered that it was not present. The explicit `src/app/api` plus
 * globstar form injects too, so the two are interchangeable and the shorter one is kept.
 *
 * Worth knowing before "fixing" a bare entry into a glob: the documented examples are all
 * explicit globs, which is why review read the short form as dead.
 *
 * Requiring a real file underneath, rather than only that the path exists, is what makes this
 * stricter than the `existsSync` check it replaced: a pattern aimed at an empty tree matches
 * nothing at runtime and should fail here rather than look healthy.
 */
const matchesSomething = (pattern: string): boolean =>
  pattern.includes("*")
    ? allFiles.some((file) => globToRegExp(pattern).test(file))
    : allFiles.some((file) => file === pattern || file.startsWith(`${pattern}/`));

describe("rule file frontmatter", () => {
  it("finds the rule files", () => {
    expect(ruleFiles.length).toBeGreaterThan(0);
  });

  /**
   * The failure here is not a broken rule file but a silently eager one, which nothing else would
   * notice: it still loads, it is still correct, and it costs what the split existed to stop
   * paying.
   */
  it.each(ruleFiles)("%s is path-scoped, so it is not loaded eagerly", (name) => {
    const paths = readPaths(name);
    expect(
      paths,
      `${name} declares no \`paths:\` key, so it loads at every session start`
    ).not.toBeNull();
    expect(
      paths?.length ?? 0,
      `${name} declares an empty \`paths:\` list, so it can never load`
    ).toBeGreaterThan(0);
  });

  /**
   * A pattern is a claim that some file in this repo is governed by the rule. Once the claim stops
   * being true the rule stops arriving at the place it was written for.
   */
  it.each(ruleFiles)("%s only names paths that exist", (name) => {
    const stale = (readPaths(name) ?? []).filter((pattern) => !matchesSomething(pattern));
    expect(stale, `${name} names paths that match nothing in the repo`).toEqual([]);
  });
});

describe("the AGENTS.md index", () => {
  const agents = readFileSync(join(ROOT, "AGENTS.md"), "utf8");

  /**
   * Claude Code loads `.claude/rules/` on its own; nothing else does. Codex reads AGENTS.md and
   * has no way to discover the directory, so for every other reader the index is the only route to
   * this material, and its "Loads on" list is the only statement of when to open a rule.
   *
   * Which makes an index that disagrees with the frontmatter worse than useless in both
   * directions, and one edit produced both at once: `validations.ts` was added to telegram.md's
   * frontmatter but landed on mcp.md's index line, so the file that loads it went unlisted while a
   * file that does not load it claimed to. Compared as sets, so the two can no longer drift.
   */
  it.each(ruleFiles)("lists the triggers %s actually declares", (name) => {
    const line = agents
      .split("\n")
      .find((candidate) => candidate.startsWith(`- **[.claude/rules/${name}]`));
    expect(line, `AGENTS.md has no index entry for ${name}`).toBeDefined();

    const tail = line!.split(" Loads on ")[1];
    expect(tail, `${name}'s index entry does not say what loads it`).toBeDefined();

    const listed = [...tail.matchAll(/`([^`]+)`/g)].map((match) => match[1]).sort();
    expect(listed, `${name}'s index entry and its \`paths:\` disagree`).toEqual(
      [...(readPaths(name) ?? [])].sort()
    );
  });

  it("names no rule file that is absent", () => {
    const linked = [...agents.matchAll(/\.claude\/rules\/([\w.-]+\.md)/g)].map((m) => m[1]);
    const missing = [...new Set(linked)].filter((name) => !existsSync(join(RULES_DIR, name)));
    expect(missing, "AGENTS.md links rule files that do not exist").toEqual([]);
  });
});

/**
 * Several rule files can be injected at once, one after another. A file opening at `##` presents
 * as a subsection of whichever rule came before it, which is how the whole API route reference
 * once read as bill-scoped material.
 */
describe("rule files are documents in their own right", () => {
  it.each(ruleFiles)("%s opens at heading level 1", (name) => {
    const lines = readFileSync(join(RULES_DIR, name), "utf8").split("\n");
    const heading = lines.slice(lines.indexOf("---", 1) + 1).find((line) => line.startsWith("#"));
    expect(heading, `${name} has no heading`).toBeDefined();
    expect(
      heading,
      `${name} opens at "${heading}", which nests it under the rule injected before it`
    ).toMatch(/^# /);
  });
});
