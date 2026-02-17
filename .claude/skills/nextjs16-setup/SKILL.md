---
name: nextjs16-setup
description: >
  Next.js 16 project conventions, setup, and best practices. Use when:
  scaffolding a new Next.js app, working on an existing Next.js 16 project,
  adding features or pages to a Next.js project, reviewing project structure,
  configuring security headers or authentication, setting up Server Actions
  or API routes, or any task involving Next.js development. Trigger keywords
  include "next.js", "nextjs", "create next app", "next project", "app router",
  "server component", "server action", "proxy.ts", "use cache".
---

# Next.js 16 Project Setup Skill

## Overview
This skill provides best practices and step-by-step instructions for scaffolding a new Next.js 16 project with modern tooling, structure, and configurations. Updated for Next.js 16 (released October 2025) which includes Turbopack as the default bundler, Cache Components, proxy.ts, and React Compiler support.

## When to Use
- User asks to create a new Next.js application
- User asks to scaffold/bootstrap a React project with SSR/SSG
- User mentions "create next app", "nextjs project", or "nextjs boilerplate"
- User wants a full-stack React application with file-based routing

## Prerequisites
- **Node.js >= 20.9** (LTS required — Node.js 18 is no longer supported in Next.js 16)
- **TypeScript >= 5.1**
- npm, yarn, pnpm, or bun available as a package manager

## What's New in Next.js 16
Key changes from Next.js 15 that affect project setup:
- **Turbopack** is now the default bundler (no config needed)
- **Cache Components** and `"use cache"` directive replace implicit caching
- **`proxy.ts`** replaces `middleware.ts` for request interception
- **React Compiler** is stable and built-in (opt-in automatic memoization)
- **`next lint` removed** — use ESLint CLI or Biome directly
- **Tailwind CSS v4** ships by default with `create-next-app`
- **`params` and `searchParams`** are now async (must use `await`)
- **AMP support** has been completely removed

## Setup Steps

### Step 1: Create the Project

```bash
npx create-next-app@latest <project-name> \
  --typescript \
  --tailwind \
  --eslint \
  --react-compiler \
  --app \
  --src-dir \
  --import-alias "@/*" \
  --use-pnpm
```

**Flag explanations:**

| Flag | Purpose |
|------|---------|
| `--typescript` | Enable TypeScript support (default in Next.js 16) |
| `--tailwind` | Initialize with Tailwind CSS v4 config (default in Next.js 16) |
| `--eslint` | Initialize with ESLint config (`@next/eslint-plugin-next`) |
| `--biome` | Initialize with Biome config (alternative to ESLint — pick one) |
| `--no-linter` | Skip linter configuration entirely |
| `--react-compiler` | Enable React Compiler for automatic memoization |
| `--app` | Use the App Router (default in Next.js 16) |
| `--src-dir` | Place source code inside a `/src` directory |
| `--import-alias "@/*"` | Set up path aliases for clean imports |
| `--use-pnpm` | Use pnpm as package manager (swap with `--use-npm`, `--use-yarn`, or `--use-bun`) |

> **Note:** In Next.js 16, `create-next-app` defaults to TypeScript, Tailwind CSS, and App Router. React Compiler and Biome can be configured either via the CLI flags above or via the interactive prompts when running `npx create-next-app@latest` without flags. While `next lint` has been removed from the build step, the `--eslint` flag still sets up `@next/eslint-plugin-next` for manual linting via npm scripts. Adjust flags based on user preferences.

**React Compiler notes:** Opt-in automatic component memoization via `reactCompiler: true` in `next.config.ts`. Runs through a Babel plugin and may slightly increase build times. Not enabled by default.

**Biome notes:** Fast, modern alternative to ESLint + Prettier that combines linting and formatting in one tool with built-in Next.js and React support. **Do not use both `--eslint` and `--biome`** — pick one.

If you need to set up React Compiler or Biome manually after project creation:

```bash
# Enable React Compiler manually:
npm install babel-plugin-react-compiler
# Then add to next.config.ts: reactCompiler: true

# Set up Biome manually:
npm install --save-dev --save-exact @biomejs/biome
npx @biomejs/biome init
```

### Step 2: Recommended Project Structure

```
<project-name>/
├── src/
│   ├── app/                       # Routes (pages, layouts, API handlers)
│   │   ├── layout.tsx             # Root layout
│   │   ├── page.tsx               # Home page
│   │   ├── loading.tsx            # Global loading UI
│   │   ├── error.tsx              # Global error UI
│   │   ├── not-found.tsx          # 404 page
│   │   ├── globals.css            # Global styles (Tailwind v4)
│   │   ├── (auth)/                # Route group: auth pages
│   │   │   ├── login/page.tsx
│   │   │   └── register/page.tsx
│   │   ├── dashboard/
│   │   │   ├── layout.tsx
│   │   │   └── page.tsx
│   │   └── api/                   # API routes
│   │       └── health/route.ts
│   ├── components/                # UI components (client-safe)
│   │   ├── ui/                    # Reusable UI primitives (Button, Input, Card, etc.)
│   │   ├── layout/                # Layout components (Header, Footer, Sidebar, etc.)
│   │   └── features/              # Feature-specific components
│   ├── server/                    # Server-only code (never imported by client components)
│   │   ├── db.ts                  # Database client (import 'server-only')
│   │   ├── auth.ts                # Auth config and helpers
│   │   ├── actions/               # Server Actions
│   │   └── dal.ts                 # Data Access Layer
│   ├── lib/                       # Shared utilities (safe for both client and server)
│   │   ├── utils.ts               # General helpers (cn, formatDate, etc.)
│   │   ├── constants.ts           # App-wide constants
│   │   └── validations.ts         # Zod schemas (shared between client and server)
│   ├── hooks/                     # Custom React hooks (client-only)
│   └── types/                     # TypeScript type definitions
│       ├── user.ts
│       └── api.ts
├── e2e/                           # Playwright e2e tests (if using)
├── public/                        # Static assets (images, fonts, icons)
├── proxy.ts                       # Request interception (replaces middleware.ts)
├── .env.local                     # Local environment variables
├── .env.example                   # Example env file for documentation
├── next.config.ts                 # Next.js configuration
├── tsconfig.json                  # TypeScript configuration
└── package.json
```

> **Security by structure:** The `src/server/` directory isolates all server-only code (database clients, auth logic, Server Actions, Data Access Layer) from client-safe code. Files in `src/server/` should include `import 'server-only'` at the top to guarantee a build error if accidentally imported from a Client Component. This prevents secrets, database connections, and private logic from leaking into client bundles.
>
> - `src/server/` — DB, auth, actions, private business logic (use `import 'server-only'`)
> - `src/lib/` — shared utilities safe for both client and server (Zod schemas, formatting, constants)
> - `src/components/` — UI components (client-safe, may use `"use client"`)
> - `src/hooks/` — React hooks (client-only by nature)

### Step 3: Common Additional Dependencies

Install based on project requirements. **Only install what the user needs.**

```bash
# UI Component Library (shadcn/ui - recommended)
npx shadcn@latest init

# State Management (if needed)
npm install zustand
# or
npm install @tanstack/react-query   # For server state

# Form Handling
npm install react-hook-form zod @hookform/resolvers

# Authentication (choose based on project needs)
# Open-source / self-hosted:
npm install next-auth@beta        # Auth.js v5 (NextAuth rebrand) — widely used, v5 is a major rewrite
# or
npm install better-auth            # Newer OSS alternative, gaining traction
# or
# Supabase Auth (if using Supabase as your backend)

# Managed / hosted services:
npm install @clerk/nextjs           # Managed auth with pre-built UI components
# or
# Auth0, Firebase Auth, etc.

# Database ORM
npm install prisma @prisma/client
# or
npm install drizzle-orm

# Date Utilities
npm install date-fns

# Icons
npm install lucide-react

# Linting (if not selected during create-next-app setup)
# Option A: ESLint (use --eslint flag or select during interactive setup)
npm install eslint eslint-config-next --save-dev
# Option B: Biome (select during interactive setup, or install manually)
npm install --save-dev --save-exact @biomejs/biome
npx @biomejs/biome init

# React Compiler (if not selected during interactive setup)
npm install babel-plugin-react-compiler
# Then add to next.config.ts: reactCompiler: true
```

### Step 3b: Authentication — Choosing a Provider

The Next.js authentication ecosystem is in active transition. Choose based on project requirements:

| Solution | Type | Best For | Notes |
|----------|------|----------|-------|
| **Auth.js v5** (NextAuth) | Open-source, self-hosted | Projects needing full control, OAuth providers, custom DB | Major rewrite from v4. Still in beta (`next-auth@beta`). Peer dependency issues with Next.js 16 may require `--legacy-peer-deps`. Uses `proxy.ts` in v5 migration guide. |
| **Better Auth** | Open-source, self-hosted | Teams wanting a modern OSS alternative | Newer library gaining community traction. Good DX and plugin system. |
| **Clerk** | Managed service | Rapid prototyping, pre-built UI, user management dashboard | Easiest setup. Free tier available. Costs scale with monthly active users. |
| **Supabase Auth** | Managed (or self-hosted) | Projects already using Supabase for database/storage | Built-in to the Supabase platform. Row-Level Security integration. |
| **Auth0** | Managed service | Enterprise, compliance-heavy apps | Mature platform. Complex pricing at scale. |

> **Key ecosystem notes:**
> - **Auth.js v5** is the successor to NextAuth v4. It's rebranded under [authjs.dev](https://authjs.dev) and built on `@auth/core`. The `next-auth` npm package is still the install target. In v5, env vars are prefixed with `AUTH_` (e.g., `AUTH_SECRET`, `AUTH_GITHUB_ID`) though `NEXTAUTH_*` still works as aliases.
> - **Lucia Auth** was deprecated in March 2025. It's now educational only — do not use for new production projects.
> - For **Server Actions security** with any auth provider, see the "Server Actions & Route Handlers Security" section below.

**Auth.js v5 quick setup (if chosen):**

```bash
npm install next-auth@beta
```

```typescript
// src/server/auth.ts
import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [GitHub],
});
```

```typescript
// src/app/api/auth/[...nextauth]/route.ts
import { handlers } from "@/server/auth";
export const { GET, POST } = handlers;
```

```typescript
// In any Server Component or Server Action:
import { auth } from "@/server/auth";

const session = await auth();
if (!session?.user) {
  // Not authenticated
}
```

### Step 4: Environment Variables Setup

Create `.env.local` and `.env.example`:

> **⚠️ Critical: `NEXT_PUBLIC_*` values are inlined at build time into client JavaScript bundles.**
> - **Never put secrets in `NEXT_PUBLIC_*` variables** — they are visible to anyone inspecting your site's source code.
> - Changing a `NEXT_PUBLIC_*` value at runtime (e.g., in your hosting platform's env settings) will NOT update already-built clients. You must **rebuild and redeploy** for changes to take effect.
> - For values that must change at runtime without rebuilding, read them server-side only (in Server Components, Server Actions, or Route Handlers) and pass to the client as needed.

```env
# .env.example

# App
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_APP_NAME="My App"

# Database
DATABASE_URL=

# Authentication (varies by provider — examples below)
# Auth.js v5:
AUTH_SECRET=           # replaces NEXTAUTH_SECRET in v5
AUTH_URL=http://localhost:3000
# Clerk:
# NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=
# CLERK_SECRET_KEY=

# API Keys
# NEXT_PUBLIC_* = inlined into client bundles at BUILD TIME (never put secrets here)
# Variables without NEXT_PUBLIC_ = server-only (safe for secrets)
```

### Step 5: Configure next.config.ts

```typescript
import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === "production";

const nextConfig: NextConfig = {
  // Enable React strict mode for development
  reactStrictMode: true,

  // Remove x-powered-by header to avoid leaking server info
  poweredByHeader: false,

  // Enable React Compiler for automatic memoization (opt-in)
  // Requires: npm install babel-plugin-react-compiler
  // reactCompiler: true,

  // Enable Cache Components for explicit caching with "use cache"
  // cacheComponents: true,

  // Turbopack is the default bundler — no config needed
  // To customize Turbopack (now top-level, not under experimental):
  // turbopack: {
  //   resolveAlias: { ... },
  // },

  // Image optimization domains (add as needed)
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "example.com",
      },
    ],
  },

  // Security headers baseline (see Step 5b below for details)
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            key: "Permissions-Policy",
            value:
              "camera=(), microphone=(), geolocation=(), browsing-topics=()",
          },
          // HSTS only in production (don't enable on localhost)
          ...(isProd
            ? [
                {
                  key: "Strict-Transport-Security",
                  value: "max-age=63072000; includeSubDomains; preload",
                },
              ]
            : []),
        ],
      },
    ];
  },

  // Redirect and rewrite rules (examples)
  // async redirects() {
  //   return [
  //     { source: "/old-page", destination: "/new-page", permanent: true },
  //   ];
  // },
};

export default nextConfig;
```

### Step 5b: Security Headers Explained

The config above includes a baseline set of security headers that most production apps should have:

| Header | Purpose |
|--------|---------|
| `poweredByHeader: false` | Removes the `x-powered-by: Next.js` header to avoid leaking server info to attackers |
| `X-Content-Type-Options: nosniff` | Prevents browsers from MIME-sniffing responses, protecting against XSS via file uploads |
| `Referrer-Policy: strict-origin-when-cross-origin` | Sends full referrer for same-origin requests, only the origin for cross-origin — balances functionality with privacy |
| `Permissions-Policy` | Disables browser APIs (camera, mic, geolocation, browsing-topics) your app doesn't use, reducing attack surface |
| `Strict-Transport-Security` (HSTS) | Forces HTTPS for 2 years with subdomain coverage. Only applied in production to avoid breaking localhost |

**Optional additions depending on your app:**

#### Content Security Policy (CSP)

CSP is the most impactful security header but also the most complex. A misconfigured CSP can break third-party scripts, analytics, fonts, and more. **The recommended approach is to start in Report-Only mode, review violations, then enforce.**

**Phase 1: Report-Only (start here)**

Add to the `headers` array in `next.config.ts` alongside the baseline headers above:

```typescript
{
  key: "Content-Security-Policy-Report-Only",
  value: [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    // Optional: send violation reports to an endpoint
    // "report-uri /api/csp-report",
  ].join("; "),
}
```

This logs violations to the browser console without blocking anything. Deploy, monitor for a few days/weeks, and review what breaks.

**Phase 2: Tighten and Enforce**

Once you've identified all legitimate sources, switch to enforcing:

```typescript
// Remove 'unsafe-inline' and 'unsafe-eval' where possible
// Add specific domains your app actually needs
{
  key: "Content-Security-Policy",
  value: [
    "default-src 'self'",
    "script-src 'self' https://www.googletagmanager.com",
    "style-src 'self' https://fonts.googleapis.com",
    "img-src 'self' data: blob:",
    "font-src 'self' https://fonts.gstatic.com",
    "connect-src 'self' https://www.google-analytics.com",
    "frame-ancestors 'none'",
  ].join("; "),
}
```

> **Note:** `frame-ancestors 'none'` in CSP replaces `X-Frame-Options` with better browser support.

**Phase 3: Strict CSP with Nonces (advanced)**

For maximum security, use nonce-based CSP configured in `proxy.ts` (not `next.config.ts`). This eliminates the need for `'unsafe-inline'`:

```typescript
// proxy.ts
import { NextRequest, NextResponse } from "next/server";

export default function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const isDev = process.env.NODE_ENV === "development";

  const cspHeader = `
    default-src 'self';
    script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""};
    style-src 'self' 'nonce-${nonce}';
    img-src 'self' data: blob:;
    font-src 'self';
    object-src 'none';
    base-uri 'self';
    form-action 'self';
    frame-ancestors 'none';
    upgrade-insecure-requests;
  `
    .replace(/\s{2,}/g, " ")
    .trim();

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", cspHeader);

  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });
  response.headers.set("Content-Security-Policy", cspHeader);

  return response;
}
```

Next.js automatically extracts the nonce from the CSP header and applies it to all generated script tags — no manual nonce injection needed.

Read the nonce in Server Components when needed:

```typescript
import { headers } from "next/headers";

export default async function Page() {
  const nonce = (await headers()).get("x-nonce");
  // Use nonce for third-party scripts
}
```

> **Important:** Nonce-based CSP requires dynamic rendering. Add `await connection()` from `next/server` if your page needs to be forced dynamic.

**CSP validation tools:**
- [csp-evaluator.withgoogle.com](https://csp-evaluator.withgoogle.com) — Google's CSP analysis tool
- [observatory.mozilla.org](https://observatory.mozilla.org) — Mozilla's security scanner
- Browser DevTools console — shows CSP violation warnings in real-time

> **Tip:** In development, `'unsafe-eval'` is required because React uses `eval()` for enhanced debugging (e.g., reconstructing server-side error stacks). This is NOT needed in production — neither React nor Next.js use `eval` in production by default.

### Step 6: Proxy Setup (replaces middleware.ts)

```typescript
// proxy.ts (project root — replaces middleware.ts)
import { NextRequest, NextResponse } from "next/server";

// Renamed from `middleware` to `proxy` in Next.js 16
export default function proxy(request: NextRequest) {
  // Example: redirect unauthenticated users
  // const token = request.cookies.get("session");
  // if (!token && request.nextUrl.pathname.startsWith("/dashboard")) {
  //   return NextResponse.redirect(new URL("/login", request.url));
  // }

  return NextResponse.next();
}

// Configuration (renamed from `config` matcher)
export const config = {
  matcher: [
    // Match all paths except static files and API routes
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
```

> **Note:** `proxy.ts` runs on the Node.js runtime only. The Edge runtime is NOT supported in proxy. If you need Edge runtime, continue using `middleware.ts` (deprecated) until further guidance is provided.

### Step 7: Base Layout Setup

```typescript
// src/app/layout.tsx
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: {
    default: "My App",
    template: "%s | My App",
  },
  description: "App description here",
  keywords: ["nextjs", "react"],
  authors: [{ name: "Your Name" }],
  openGraph: {
    title: "My App",
    description: "App description here",
    url: "https://myapp.com",
    siteName: "My App",
    locale: "en_US",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${inter.variable} font-sans antialiased`}>
        {children}
      </body>
    </html>
  );
}
```

### Step 8: Utility Helpers

```typescript
// src/lib/utils.ts
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

> Install required packages: `npm install clsx tailwind-merge`

### Step 9: Cache Components (Optional)

To enable the new explicit caching model:

1. Enable in `next.config.ts`:
```typescript
const nextConfig: NextConfig = {
  cacheComponents: true,
};
```

2. Use `"use cache"` directive at page, component, or function level:
```typescript
// src/app/blog/page.tsx
"use cache";

export default async function BlogPage() {
  const posts = await fetchPosts();
  return (
    <div>
      {posts.map((post) => (
        <article key={post.id}>{post.title}</article>
      ))}
    </div>
  );
}
```

3. Configure cache lifetime with `cacheLife`:
```typescript
import { cacheLife } from "next/cache";

export default async function ProductList() {
  "use cache";
  cacheLife("hours");

  const products = await getProducts();
  return <div>{/* render products */}</div>;
}
```

4. Wrap dynamic content in `<Suspense>` for Partial Prerendering:
```typescript
import { Suspense } from "react";

export default function Page() {
  return (
    <div>
      {/* Static shell — renders instantly */}
      <h1>Dashboard</h1>

      {/* Dynamic — streams in when ready */}
      <Suspense fallback={<p>Loading stats...</p>}>
        <DynamicStats />
      </Suspense>
    </div>
  );
}
```

> **Key principle:** With Cache Components, nothing is cached by default. You explicitly opt in with `"use cache"`. Dynamic code runs at request time unless you tell it otherwise.

### Step 10: DevTools MCP Setup (Optional)

Next.js 16 includes DevTools MCP for AI-assisted debugging:

```json
// .mcp.json or your MCP client config
{
  "mcpServers": {
    "next-devtools": {
      "command": "npx",
      "args": ["-y", "next-devtools-mcp@latest"]
    }
  }
}
```

This enables AI coding agents (like Claude Code) to diagnose issues and suggest fixes with full context of your Next.js app.

## Best Practices and Conventions

### Naming Conventions
- **Components:** PascalCase (e.g. `UserCard.tsx`)
- **Utilities/hooks:** camelCase (e.g. `useAuth.ts`, `formatDate.ts`)
- **Route files:** lowercase (e.g. `page.tsx`, `layout.tsx`, `route.ts`)
- **Proxy file:** `proxy.ts` at project root (NOT `middleware.ts`)

### Component Guidelines
- Use Server Components by default (no `"use client"` unless needed)
- Add `"use client"` only for components that need interactivity, hooks, or browser APIs
- If React Compiler is enabled (`reactCompiler: true`), it handles memoization automatically — no need for manual `useMemo`/`useCallback` in most cases
- Colocate components with their routes when they are page-specific
- Place shared/reusable components in `src/components/`

### Async Params (Breaking Change)
In Next.js 16, `params` and `searchParams` are async:

```typescript
// Next.js 16 — must await params
export default async function Page({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return <div>{slug}</div>;
}
```

### Data Fetching
- Prefer Server Components with `async/await` for data fetching
- Use `"use cache"` directive for explicit caching (when `cacheComponents` is enabled)
- Use React Query or SWR for client-side data fetching
- Implement loading states with `loading.tsx` and `<Suspense>` boundaries
- With Cache Components, all fetches are dynamic by default — opt into caching explicitly

### Performance
- **Turbopack** is the default — no configuration needed for dev or build
- Use `next/image` for all images
- Use `next/font` for font loading
- Use dynamic imports (`next/dynamic`) for heavy client components
- Implement proper `loading.tsx` and `error.tsx` boundaries
- Use `generateStaticParams()` for static generation of dynamic routes
- Enable `cacheComponents` and use `"use cache"` + `<Suspense>` for Partial Prerendering

### SEO
- Define `metadata` or `generateMetadata()` in every page/layout
- Use semantic HTML elements
- Implement proper Open Graph and Twitter Card meta tags
- Add a `robots.ts` and `sitemap.ts` in the app directory

### Security
- Always set `poweredByHeader: false` in `next.config.ts`
- Include baseline security headers via `async headers()` (see Step 5b)
- Adopt CSP progressively: start with `Content-Security-Policy-Report-Only`, tighten over time, enforce when stable
- Aim to eliminate `'unsafe-inline'` and `'unsafe-eval'` in production — use nonce-based CSP (Phase 3) when ready
- For nonce-based CSP, configure in `proxy.ts` instead of `next.config.ts`
- Validate all user input in Server Actions and API routes
- Use a Data Access Layer pattern to isolate database access from components
- Audit `proxy.ts` and `route.ts` files carefully — they have elevated privileges
- Use `import 'server-only'` in modules that access secrets or database connections to prevent accidental client-side imports
- Validate CSP at [csp-evaluator.withgoogle.com](https://csp-evaluator.withgoogle.com)
- Test overall headers at [securityheaders.com](https://securityheaders.com) after deployment

### Server Actions & Route Handlers Security

**Server Actions are public HTTP POST endpoints.** Every function marked with `"use server"` creates an endpoint that can be discovered in your JavaScript bundle and called directly — bypassing your UI, proxy, type guards, and component-level protections. Treat them exactly like public API routes.

**The "must do" checklist for every Server Action and Route Handler:**

#### 1. Authenticate (verify the user's identity)

The examples below use a generic `auth()` helper — replace with your chosen auth library's session check (e.g., `auth()` from Auth.js v5, `currentUser()` from Clerk, `getSession()` from Better Auth).

```typescript
"use server";

import { auth } from "@/server/auth";

export async function updateProfile(formData: FormData) {
  const session = await auth();
  if (!session?.user) {
    throw new Error("Unauthorized");
  }

  // ... proceed with the action
}
```

> Never assume a user is authenticated just because the action is called from an authenticated page. The action is a public endpoint — always re-verify.

#### 2. Authorize (verify permissions / ownership)

```typescript
"use server";

import { auth } from "@/server/auth";
import { db } from "@/server/db";

export async function deletePost(postId: string) {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");

  // Check ownership — don't just check if logged in
  const post = await db.post.findUnique({ where: { id: postId } });
  if (post?.authorId !== session.user.id) {
    throw new Error("Forbidden");
  }

  await db.post.delete({ where: { id: postId } });
}
```

#### 3. Validate input (never trust client data)

TypeScript types disappear at runtime. Always validate with a schema library like Zod:

```typescript
"use server";

import { z } from "zod";
import { auth } from "@/server/auth";

const updateProfileSchema = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email(),
});

export async function updateProfile(formData: FormData) {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");

  const parsed = updateProfileSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
  });

  if (!parsed.success) {
    return { error: parsed.error.flatten().fieldErrors };
  }

  // Safe to use parsed.data
  await db.user.update({
    where: { id: session.user.id },
    data: parsed.data,
  });
}
```

#### 4. Rate limit (prevent abuse)

Apply rate limiting to sensitive actions, especially sign-ups, password resets, and contact forms:

```typescript
// Using Upstash Redis rate limiter (example)
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { headers } from "next/headers";

const ratelimit = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(10, "60 s"), // 10 requests per minute
});

export async function submitContactForm(formData: FormData) {
  const headersList = await headers();
  const ip = headersList.get("x-forwarded-for") ?? "anonymous";

  const { success } = await ratelimit.limit(ip);
  if (!success) {
    throw new Error("Too many requests. Please try again later.");
  }

  // ... proceed with the action
}
```

#### 5. CSRF considerations

Next.js provides built-in CSRF protection for Server Actions: they only accept POST requests and verify the `Origin` header against the `Host` header automatically. This prevents most CSRF attacks in modern browsers with `SameSite` cookies.

However, for **Route Handlers** (`route.ts`), CSRF protection is NOT automatic — you must implement it manually if they handle mutations. For apps using reverse proxies or multi-layered backends, configure `serverActions.allowedOrigins` in `next.config.ts`:

```typescript
const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      allowedOrigins: ["my-app.com", "*.my-app.com"],
    },
  },
};
```

#### Security audit checklist for "use server" files

For each Server Action, verify:
- Input is validated with a Zod schema (or equivalent)
- User is authenticated (unless the action is intentionally public)
- User is authorized (ownership or role check)
- Closures don't capture sensitive data that gets sent to the client
- Rate limiting is applied to sensitive operations
- Error messages don't leak internal details (React strips these in production, but be cautious)

#### Recommended pattern: composable action wrapper

To avoid repeating auth/validation boilerplate, create a reusable wrapper:

```typescript
// src/server/safe-action.ts
import { auth } from "@/server/auth";
import { z } from "zod";

export function authenticatedAction<TInput, TOutput>(
  schema: z.ZodSchema<TInput>,
  handler: (input: TInput, userId: string) => Promise<TOutput>
) {
  return async (rawInput: TInput) => {
    "use server";

    const session = await auth();
    if (!session?.user?.id) throw new Error("Unauthorized");

    const parsed = schema.safeParse(rawInput);
    if (!parsed.success) {
      return { error: parsed.error.flatten().fieldErrors };
    }

    return handler(parsed.data, session.user.id);
  };
}
```

> **Data Access Layer:** For larger projects, consolidate all database access into a dedicated layer (`src/server/dal.ts`) that handles auth checks internally. This ensures authorization is never accidentally skipped, regardless of which Server Action or component triggers the data access.

### Linting
- `next lint` has been removed in Next.js 16 — linting no longer runs automatically during `next build`
- **ESLint** — still fully supported via `eslint-config-next`. Set up with the `--eslint` flag or manually
- **Biome** — now a first-class option in `create-next-app` (interactive prompt only). Combines linting + formatting in one tool with faster performance than ESLint + Prettier
- Add lint scripts to `package.json`:

```json
{
  "scripts": {
    "lint": "eslint . --ext .ts,.tsx",
    "lint:fix": "eslint . --ext .ts,.tsx --fix"
  }
}
```

Or if using Biome:

```json
{
  "scripts": {
    "lint": "biome check .",
    "lint:fix": "biome check --write ."
  }
}
```

## Modern Tooling (Optional but Recommended)

These aren't required for every project, but most production teams adopt some or all of these. Include based on project scope.

### Formatting

Choose **one** formatter — do not run both:

- **Biome** — linting + formatting in one tool (if selected during `create-next-app` setup, you're already covered)
- **Prettier** — standalone formatter, pairs with ESLint

```bash
# Option A: Biome (already handles formatting if chosen as linter)
# No extra setup needed — biome check --write handles both

# Option B: Prettier (if using ESLint as linter)
npm install --save-dev prettier eslint-config-prettier
```

> **Do not run Biome and Prettier together.** They will conflict on formatting rules. Pick one and stick with it.

### Testing

```bash
# Unit / integration testing
npm install --save-dev vitest @testing-library/react @testing-library/jest-dom
# or
npm install --save-dev jest @testing-library/react @testing-library/jest-dom

# End-to-end testing
npm install --save-dev @playwright/test
npx playwright install
```

Recommended test structure:

```
src/
├── __tests__/              # Unit/integration tests (colocated or centralized)
├── app/
│   └── dashboard/
│       ├── page.tsx
│       └── page.test.tsx   # Colocated test (alternative)
e2e/                        # Playwright e2e tests (project root)
├── home.spec.ts
└── auth.spec.ts
```

Add test scripts to `package.json`:

```json
{
  "scripts": {
    "test": "vitest",
    "test:e2e": "playwright test",
    "test:coverage": "vitest --coverage"
  }
}
```

### CI Pipeline

At minimum, a CI pipeline (GitHub Actions, GitLab CI, etc.) should run:

```yaml
# Example GitHub Actions workflow (.github/workflows/ci.yml)
name: CI
on: [push, pull_request]
jobs:
  ci:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "22"
          cache: "npm"
      - run: npm ci
      - run: npm audit --audit-level=high    # Dependency vulnerability check
      - run: npx tsc --noEmit                # Type check
      - run: npm run lint                     # Lint (ESLint or Biome)
      - run: npm run test                    # Unit tests
      - run: npm run build                   # Verify build succeeds
```

### Git Hooks (Optional)

Enforce code quality before commits reach CI:

```bash
npm install --save-dev husky lint-staged
npx husky init
```

```json
// package.json
{
  "lint-staged": {
    "*.{ts,tsx}": [
      "eslint --fix",
      "prettier --write"
    ]
  }
}
```

Or with Biome:

```json
{
  "lint-staged": {
    "*.{ts,tsx,js,jsx,json,css,md}": [
      "biome check --write --no-errors-on-unmatched"
    ]
  }
}
```

Add the pre-commit hook:

```bash
echo "npx lint-staged" > .husky/pre-commit
```

### Dependency Updates

Automate dependency update PRs to catch security patches and stay current:

- **Renovate** (recommended) — highly configurable, supports monorepos, groups updates intelligently. Add a `renovate.json` to your repo root:

```json
{
  "$schema": "https://docs.renovatebot.com/renovate-schema.json",
  "extends": ["config:recommended"]
}
```

- **Dependabot** — GitHub-native, simpler config. Add `.github/dependabot.yml`:

```yaml
version: 2
updates:
  - package-ecosystem: "npm"
    directory: "/"
    schedule:
      interval: "weekly"
```

> **Tip:** Combine automated dependency updates with a CI pipeline that runs tests — this way you catch breaking updates before they merge.

## Deployment Checklist

Before deploying, ensure:

1. **Node.js >= 20.9** is available on the deployment platform
2. `next build` runs without errors
3. All environment variables are set in the deployment platform
4. No secrets are stored in `NEXT_PUBLIC_*` variables (these are exposed in client bundles)
5. Images use `next/image` with proper `remotePatterns` configured
6. Metadata is set for all public pages
7. Error boundaries (`error.tsx`) are in place
8. Loading states (`loading.tsx`) are implemented for dynamic content
9. API routes have proper error handling and validation
10. `middleware.ts` has been renamed to `proxy.ts` (if applicable)
11. All `params`/`searchParams` access uses `await`
12. Security headers are configured and verified (test at securityheaders.com)
13. CSP is deployed in Report-Only mode at minimum (validate at csp-evaluator.withgoogle.com)
14. All Server Actions have authentication, authorization, and input validation
15. CI pipeline passes: type check, lint, tests, and build
16. `npm audit` shows no high/critical vulnerabilities

## Common Deployment Targets

- **Vercel** (recommended, zero-config): `vercel deploy`
- **Coolify** (self-hosted): Docker-based deployment with `Dockerfile`
- **Docker**: Use the official Next.js Dockerfile from `next.js/examples/with-docker`
- **Static Export**: Set `output: 'export'` in `next.config.ts` for static hosting

> **Note:** Next.js 16 supports Build Adapters (alpha) for custom deployment integrations.

## Upgrading from Next.js 15

If upgrading an existing project:

```bash
# Automated upgrade (recommended)
npx @next/codemod@canary upgrade latest

# Manual upgrade
npm install next@latest react@latest react-dom@latest
```

The codemod handles most migrations automatically, including:
- Renaming `middleware.ts` → `proxy.ts`
- Updating `experimental.turbopack` → top-level `turbopack`
- Renaming config flags (e.g. `skipMiddlewareUrlNormalize` → `skipProxyUrlNormalize`)

## Troubleshooting

| Issue | Solution |
|-------|---------|
| Hydration mismatch | Ensure client/server render the same initial HTML. Check for `typeof window` usage. |
| Module not found with `@/` | Verify `tsconfig.json` paths and `next.config.ts` alias settings |
| API route not working | Ensure file is named `route.ts` (not `page.ts`) inside `app/api/` |
| Tailwind classes not applying | Tailwind v4 uses CSS-based config — check `globals.css` for `@import "tailwindcss"` |
| Build fails on deployment | Run `next build` locally first. Ensure Node.js >= 20.9 and env vars are available at build time. |
| Images not loading | Add domain to `images.remotePatterns` in `next.config.ts` |
| `middleware.ts` not running | Renamed to `proxy.ts` in Next.js 16. Rename file and export function as `proxy`. |
| "Uncached data was accessed outside of Suspense" | Enable `cacheComponents`, then wrap dynamic content in `<Suspense>` or add `"use cache"` |
| `params`/`searchParams` type errors | These are now async — use `await params` instead of accessing directly |
| `next lint` command not found | Removed in Next.js 16 — use `eslint` CLI or `biome check` directly via npm scripts |
| Webpack config found error | Turbopack is now default. Use `--webpack` flag to opt out, or migrate config to `turbopack` key |
| CSP blocking third-party scripts | Switch to `Content-Security-Policy-Report-Only` first to identify violations without breaking anything. Add legitimate sources, then enforce. Use browser console to identify blocked resources. |
| HSTS breaking localhost | Only apply `Strict-Transport-Security` in production using `process.env.NODE_ENV === "production"` check |
| Server Action called with unexpected data | TypeScript types are erased at runtime. Always validate input with Zod. Never trust `formData` or arguments from the client. |
| CSRF error on Server Action | Next.js checks `Origin` vs `Host` headers. For reverse proxies, configure `serverActions.allowedOrigins` in `next.config.ts` |
| `next-auth` peer dependency error on Next.js 16 | Auth.js v5 may not list Next.js 16 in its peer deps yet. Install with `npm install next-auth@beta --legacy-peer-deps` |
| `NEXT_PUBLIC_*` env var not updating after change | These are inlined at build time. You must rebuild and redeploy — runtime env changes won't take effect for client code |