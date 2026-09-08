/**
 * The slice of Telegram's WebApp API this Mini App uses.
 *
 * Hand-written rather than pulled from `@telegram-apps/sdk` or `@types/telegram-web-app`, because
 * the script itself has to come from Telegram's CDN either way -- it is the one file that cannot
 * be bundled -- so a package would add a dependency and still not be the thing running. Narrowing
 * it to what is actually called also makes the feature-detection below honest: everything optional
 * here is optional because some client really does not have it.
 *
 * Every method is marked optional for that reason. `window.Telegram.WebApp` exists on every
 * client, but individual methods arrived in different Bot API versions, and calling a missing one
 * throws and blanks the page. Optional types force `?.()` at each call site.
 */
declare global {
  interface TelegramHapticFeedback {
    impactOccurred?: (style: "light" | "medium" | "heavy" | "rigid" | "soft") => void;
    notificationOccurred?: (type: "error" | "success" | "warning") => void;
    selectionChanged?: () => void;
  }

  interface TelegramBottomButton {
    text: string;
    isVisible: boolean;
    isActive: boolean;
    show: () => void;
    hide: () => void;
    enable: () => void;
    disable: () => void;
    setText: (text: string) => void;
    setParams?: (params: {
      text?: string;
      color?: string;
      text_color?: string;
      is_active?: boolean;
      is_visible?: boolean;
    }) => void;
    showProgress?: (leaveActive?: boolean) => void;
    hideProgress?: () => void;
    onClick: (handler: () => void) => void;
    offClick: (handler: () => void) => void;
  }

  interface TelegramBackButton {
    isVisible: boolean;
    show: () => void;
    hide: () => void;
    onClick: (handler: () => void) => void;
    offClick: (handler: () => void) => void;
  }

  interface TelegramWebApp {
    /** The signed payload. Sent verbatim as `Authorization: tma <initData>`; never parsed here. */
    initData: string;
    version: string;
    colorScheme: "light" | "dark";
    viewportHeight: number;
    /** Excludes the on-screen keyboard, unlike `viewportHeight`. */
    viewportStableHeight: number;
    isExpanded: boolean;
    ready: () => void;
    expand: () => void;
    close: () => void;
    isVersionAtLeast: (version: string) => boolean;
    setHeaderColor?: (color: string) => void;
    setBackgroundColor?: (color: string) => void;
    /** Bot API 7.7+. Without it, a downward swipe on a tap grid dismisses the app. */
    disableVerticalSwipes?: () => void;
    onEvent?: (event: string, handler: () => void) => void;
    offEvent?: (event: string, handler: () => void) => void;
    MainButton?: TelegramBottomButton;
    BackButton?: TelegramBackButton;
    HapticFeedback?: TelegramHapticFeedback;
  }

  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}

export {};
