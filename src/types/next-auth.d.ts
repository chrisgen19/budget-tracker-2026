/**
 * NextAuth module augmentation, deliberately kept out of `src/types/index.ts`.
 *
 * `declare module "next-auth"` is only legal where next-auth actually resolves. It used to sit at
 * the bottom of `index.ts`, which made that whole file -- and therefore every module reaching it
 * -- unusable from `mcp-server/`, a standalone package whose dependency list is three `link:`
 * entries and no next-auth. That is why `bill-dates.ts` was written with no imports at all, and
 * it is what blocked the MCP server from ever seeing `AssessmentFacts`.
 *
 * Splitting it into a `.d.ts` costs nothing here: the root tsconfig includes every `.ts` under the
 * repo, so the app still picks it up, while `mcp-server/tsconfig.json` includes only its own `src`
 * directory and never loads it.
 */
import type { UserRole } from "@prisma/client";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      name: string;
      email: string;
      role: UserRole;
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    role: UserRole;
  }
}
