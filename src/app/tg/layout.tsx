import type { Metadata, Viewport } from "next";
import Script from "next/script";

/**
 * The Telegram Mini App's own chrome, and deliberately almost none of it.
 *
 * Outside the `(app)` group on purpose: that layout redirects to `/login` whenever there is no
 * NextAuth session, and there never is one here -- the page authenticates with `initData` on every
 * request instead. It also mounts `AppShell`, `UserProvider` and the install banner, none of which
 * belong inside a webview.
 *
 * Nothing user-specific is rendered on the server. There is no session at this layer, so there is
 * no user to render *from*; every figure arrives over `/api/tg/*` after the SDK hands the page its
 * credential. Anything added here that reads the database would be reading it as nobody.
 */
export const metadata: Metadata = {
  title: "Quick Log",
  // A Mini App URL is public, and there is no reason for it to be indexed.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#FAF7F2",
  viewportFit: "cover",
};

export default function TelegramLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {/*
        The one script that has to be remote: Telegram serves it from its own CDN and a bundled
        copy is not the thing running in the client. `beforeInteractive` so `window.Telegram`
        exists before any effect looks for it, rather than being raced by hydration.
      */}
      <Script src="https://telegram.org/js/telegram-web-app.js" strategy="beforeInteractive" />
      {/*
        `--tg-vh` is written by `useViewportHeight` from `viewportStableHeight`, which excludes the
        on-screen keyboard. The `100dvh` fallback is what a plain browser gets, which is how this
        page is reached during development.
      */}
      <div className="min-h-[var(--tg-vh,100dvh)] bg-cream-100 text-warm-800">{children}</div>
    </>
  );
}
