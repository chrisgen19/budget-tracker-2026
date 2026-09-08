"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

/**
 * The Telegram WebApp SDK, feature-detected and made safe to call.
 *
 * Everything here is optional-chained. `window.Telegram.WebApp` exists on every client, but its
 * individual methods arrived in different Bot API versions and calling a missing one throws --
 * which in a webview means a blank page rather than a stack trace anybody sees. A no-op is the
 * right degradation for chrome and haptics: the grid still works without them.
 *
 * It also has to survive running in an ordinary browser with no Telegram at all, which is how
 * `pnpm dev` and the e2e path reach it.
 */

/** Light & Warm's page background, `cream-100`. Telegram's own chrome cannot be reached by CSS. */
const HEADER_COLOR = "#FAF7F2";
/** `amber.DEFAULT`, so the platform button is the app's accent rather than Telegram blue. */
const ACCENT_COLOR = "#C8702A";

export interface TelegramRuntime {
  /** Null until the mount effect has run, so the first client render matches the server's. */
  webApp: TelegramWebApp | null;
  /**
   * The raw signed payload, or null when there is none to use.
   *
   * Null does **not** imply the SDK is absent. `telegram-web-app.js` loads on any page and, outside
   * a Telegram client, still installs a `WebApp` whose `initData` is the empty string. The
   * credential is the thing that decides whether this app can do anything, so it is reported
   * separately from whether the object exists.
   */
  initData: string | null;
  /** Whether a `WebApp` object was found at all. Not a claim that it carries a credential. */
  inTelegram: boolean;
  /**
   * Whether the mount effect has run.
   *
   * Without it, "no credential" and "not looked yet" are the same state, and the app cannot tell a
   * spinner from a refusal. That distinction is what an e2e run caught: gated on the object rather
   * than on this, a plain browser sat on a spinner that never resolved.
   */
  resolved: boolean;
}

export const useTelegramWebApp = (): TelegramRuntime => {
  const [runtime, setRuntime] = useState<TelegramRuntime>({
    webApp: null,
    initData: null,
    inTelegram: false,
    resolved: false,
  });

  useEffect(() => {
    const webApp = window.Telegram?.WebApp;
    if (!webApp) {
      setRuntime({ webApp: null, initData: null, inTelegram: false, resolved: true });
      return;
    }

    // `ready` dismisses Telegram's loading placeholder, so it goes first: everything after is
    // decoration, and a throw in any of it would leave the app hidden behind a spinner.
    webApp.ready();
    webApp.expand();

    // The three calls that reach the chrome CSS cannot. Without them the page is a bright card
    // inside a dark client, which is the "website in a frame" look #209 warned about.
    webApp.setHeaderColor?.(HEADER_COLOR);
    webApp.setBackgroundColor?.(HEADER_COLOR);
    // Bot API 7.7+. Without it a downward swipe on a grid of buttons dismisses the whole app
    // mid-tap, which on a tap-first interface is the worst possible gesture to leave enabled.
    webApp.disableVerticalSwipes?.();

    setRuntime({
      webApp,
      // Empty counts as absent. An empty string is what the CDN script installs outside a Telegram
      // client, and sending `Authorization: tma ` would be a 401 with a more confusing cause.
      initData: webApp.initData || null,
      inTelegram: true,
      resolved: true,
    });
  }, []);

  return runtime;
};

/**
 * The height Telegram actually gives the page.
 *
 * `viewportStableHeight` rather than `viewportHeight`: the latter shrinks when the on-screen
 * keyboard opens, so a layout pinned to it jumps every time a field is focused. Stable excludes
 * the keyboard and, unlike `visualViewport`, already accounts for Telegram's own chrome -- which
 * is why this does not reuse the `visualViewport` approach `modal.tsx` takes for iOS Safari.
 *
 * Written to a CSS custom property rather than returned as a number, so layout stays in CSS and
 * a re-render is not needed on every resize. Falls back to `100dvh` outside Telegram.
 */
export const useViewportHeight = (webApp: TelegramWebApp | null): void => {
  useEffect(() => {
    if (!webApp) return;

    const apply = () => {
      const height = webApp.viewportStableHeight;
      if (height > 0) {
        document.documentElement.style.setProperty("--tg-vh", `${height}px`);
      }
    };

    apply();
    webApp.onEvent?.("viewportChanged", apply);
    return () => webApp.offEvent?.("viewportChanged", apply);
  }, [webApp]);
};

/**
 * Telegram's own bottom button, driven from React.
 *
 * The platform convention for a commit action, and it gets keyboard-safe placement for free --
 * which an in-page button at the bottom of a webview does not.
 *
 * The click handler is held in a ref and registered once. Re-registering on every render would
 * mean `offClick`/`onClick` churn on a handler Telegram holds by identity, and a stale closure
 * reaching the button is exactly how a save writes the previous amount.
 */
export const useMainButton = (
  webApp: TelegramWebApp | null,
  options: { text: string; visible: boolean; enabled: boolean; onClick: () => void }
): void => {
  const { text, visible, enabled, onClick } = options;
  const handler = useRef(onClick);
  // Updated after commit, never during render. Telegram holds the listener and fires it from
  // outside React, so a handler swapped in by a render React then abandons would still be the one
  // invoked -- submitting an amount, or a busy state, that is not on screen.
  useLayoutEffect(() => {
    handler.current = onClick;
  });

  useEffect(() => {
    const button = webApp?.MainButton;
    if (!button) return;

    const fire = () => handler.current();
    button.onClick(fire);
    return () => button.offClick(fire);
  }, [webApp]);

  useEffect(() => {
    const button = webApp?.MainButton;
    if (!button) return;

    // `setParams` carries the colour on clients that support it; `setText` is the floor every
    // client has, so the label lands either way.
    button.setText(text);
    button.setParams?.({ color: ACCENT_COLOR, text_color: "#FFFFFF" });

    if (visible) button.show();
    else button.hide();

    if (enabled) button.enable();
    else button.disable();
  }, [webApp, text, visible, enabled]);

  // Hidden on unmount, or the button outlives the screen that put it there.
  useEffect(() => {
    const button = webApp?.MainButton;
    return () => button?.hide();
  }, [webApp]);
};

/**
 * Telegram's back arrow, so system back navigates *within* the app rather than closing it.
 *
 * Without it, backing out of the amount pad closes the whole Mini App and loses the entry.
 */
export const useBackButton = (
  webApp: TelegramWebApp | null,
  options: { visible: boolean; onClick: () => void }
): void => {
  const { visible, onClick } = options;
  const handler = useRef(onClick);
  useLayoutEffect(() => {
    handler.current = onClick;
  });

  useEffect(() => {
    const button = webApp?.BackButton;
    if (!button) return;

    const fire = () => handler.current();
    button.onClick(fire);
    return () => button.offClick(fire);
  }, [webApp]);

  useEffect(() => {
    const button = webApp?.BackButton;
    if (!button) return;
    if (visible) button.show();
    else button.hide();
    return () => button.hide();
  }, [webApp, visible]);
};

/** Haptics, in two distinct signals. */
export const useHaptics = (webApp: TelegramWebApp | null) => {
  // Two signals rather than one, and this is the whole reason the hook exists: an impact on the
  // tap says "received", a notification on the response says "written". Collapsing them into one
  // buzz is how you get "I tapped it, did it save?" -- which for a logging app is the question the
  // haptic was meant to answer.
  const tapped = useCallback(() => {
    webApp?.HapticFeedback?.impactOccurred?.("medium");
  }, [webApp]);

  const settled = useCallback(
    (ok: boolean) => {
      webApp?.HapticFeedback?.notificationOccurred?.(ok ? "success" : "error");
    },
    [webApp]
  );

  return { tapped, settled };
};
