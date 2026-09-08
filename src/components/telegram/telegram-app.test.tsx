import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchBootstrap: vi.fn(),
  postLog: vi.fn(),
}));

vi.mock("@/components/telegram/tg-api", async () => {
  // The error class carries the "did anything get written" classification the retry rests on, so
  // it is the real one rather than a stub.
  const actual = await vi.importActual<typeof import("@/components/telegram/tg-api")>(
    "@/components/telegram/tg-api"
  );
  return { ...actual, fetchBootstrap: mocks.fetchBootstrap, postLog: mocks.postLog };
});

import { TgRequestError } from "@/components/telegram/tg-api";
import { TelegramApp } from "@/components/telegram/telegram-app";

const BOOTSTRAP = {
  user: { currency: "PHP", timezoneOffset: -480 },
  tiles: [
    {
      id: "tile_fixed",
      label: "To office",
      description: "fare to office",
      amount: 38,
      type: "EXPENSE" as const,
      categoryId: "transportation",
      resolvedCategoryId: "transportation",
      resolvedCategoryName: "Transportation",
      fallsBack: false,
      sortOrder: 10,
    },
    {
      id: "tile_ask",
      label: "Lunch at work",
      description: "lunch at work",
      amount: null,
      type: "EXPENSE" as const,
      categoryId: null,
      resolvedCategoryId: "food",
      resolvedCategoryName: "Food & Dining",
      fallsBack: true,
      sortOrder: 20,
    },
  ],
  frequent: [
    {
      key: "grab",
      description: "grab",
      count: 9,
      amount: 250,
      amountIsStable: true,
      categoryId: "transportation",
      categoryName: "Transportation",
      lastLoggedAt: "2026-09-01T00:00:00.000Z",
    },
    {
      key: "gsm green",
      description: "GSM Green",
      count: 13,
      amount: 231.5,
      amountIsStable: false,
      categoryId: "transportation",
      categoryName: "Transportation",
      lastLoggedAt: "2026-09-02T00:00:00.000Z",
    },
  ],
  categories: [],
  limits: { maxTiles: 12 },
};

const logResult = (over: Record<string, unknown> = {}) => ({
  id: "tx_1",
  amount: 38,
  description: "fare to office",
  categoryName: "Transportation",
  categoryVia: "tile",
  labels: [],
  replayed: false,
  ...over,
});

/** A minimal WebApp, so the SDK path runs rather than the browser fallback. */
const stubTelegram = () => {
  const handlers: Record<string, () => void> = {};
  const main = {
    text: "",
    isVisible: false,
    isActive: true,
    show: vi.fn(),
    hide: vi.fn(),
    enable: vi.fn(),
    disable: vi.fn(),
    setText: vi.fn(),
    setParams: vi.fn(),
    onClick: vi.fn((h: () => void) => {
      handlers.main = h;
    }),
    offClick: vi.fn(),
  };

  window.Telegram = {
    WebApp: {
      initData: "auth_date=1&hash=x",
      version: "7.0",
      colorScheme: "light",
      viewportHeight: 600,
      viewportStableHeight: 600,
      isExpanded: true,
      ready: vi.fn(),
      expand: vi.fn(),
      close: vi.fn(),
      isVersionAtLeast: () => true,
      MainButton: main,
      BackButton: {
        isVisible: false,
        show: vi.fn(),
        hide: vi.fn(),
        onClick: vi.fn(),
        offClick: vi.fn(),
      },
      HapticFeedback: { impactOccurred: vi.fn(), notificationOccurred: vi.fn() },
    } as unknown as TelegramWebApp,
  };

  return { pressMainButton: () => handlers.main?.() };
};

beforeEach(() => {
  window.sessionStorage.clear();
  mocks.fetchBootstrap.mockResolvedValue(BOOTSTRAP);
  mocks.postLog.mockResolvedValue(logResult());
});

afterEach(() => {
  delete window.Telegram;
});

describe("TelegramApp: the grid", () => {
  it("renders the three sections", async () => {
    stubTelegram();
    render(<TelegramApp />);

    expect(await screen.findByText("Routine")).toBeTruthy();
    expect(screen.getByText("Custom amount")).toBeTruthy();
    expect(screen.getByText("Frequent")).toBeTruthy();
  });

  it("shows where a degraded tile will actually file", async () => {
    // A tile whose category was deleted while the app was closed is visible in the grid rather
    // than revealing itself on the next tap.
    stubTelegram();
    render(<TelegramApp />);

    await screen.findByText("Lunch at work");
    expect(screen.getByText("Food & Dining")).toBeTruthy();
  });

  it("refuses to run outside Telegram rather than rendering a dead grid", async () => {
    render(<TelegramApp />);

    expect(await screen.findByText("Open this from Telegram")).toBeTruthy();
    expect(mocks.fetchBootstrap).not.toHaveBeenCalled();
  });

  it("refuses when the SDK loaded but carries no credential", async () => {
    // Found by an e2e run in a real browser, and invisible to jsdom because there is no CDN there.
    // `telegram-web-app.js` loads on *any* page and, outside a Telegram client, still installs a
    // `WebApp` whose `initData` is the empty string. Gated on the object rather than the
    // credential, this sat on a spinner that never resolved -- which is what somebody opening the
    // URL in Safari would have seen.
    stubTelegram();
    window.Telegram!.WebApp!.initData = "";

    render(<TelegramApp />);

    expect(await screen.findByText("Open this from Telegram")).toBeTruthy();
    expect(mocks.fetchBootstrap).not.toHaveBeenCalled();
  });
});

describe("TelegramApp: logging", () => {
  it("logs a fixed tile on one tap", async () => {
    stubTelegram();
    render(<TelegramApp />);

    fireEvent.click(await screen.findByText("To office"));

    await waitFor(() => expect(mocks.postLog).toHaveBeenCalled());
    const [, input] = mocks.postLog.mock.calls.at(-1)!;
    expect(input).toMatchObject({ tileId: "tile_fixed", amount: 38 });
  });

  it("opens the pad for a tile that asks, rather than logging", async () => {
    stubTelegram();
    render(<TelegramApp />);

    fireEvent.click(await screen.findByText("Lunch at work"));

    expect(await screen.findByLabelText("Delete")).toBeTruthy();
    expect(mocks.postLog).not.toHaveBeenCalled();
  });

  it("logs a stable frequent entry on one tap", async () => {
    stubTelegram();
    render(<TelegramApp />);

    fireEvent.click(await screen.findByText("grab"));

    await waitFor(() => expect(mocks.postLog).toHaveBeenCalled());
    expect(mocks.postLog.mock.calls.at(-1)![1]).toMatchObject({ amount: 250 });
  });

  it("opens the pad for an unstable frequent entry", async () => {
    // The rule: the user may assert a fixed amount, the system may only suggest one. A varying
    // amount must not write itself into the ledger on a single tap.
    stubTelegram();
    render(<TelegramApp />);

    fireEvent.click(await screen.findByText("GSM Green"));

    expect(await screen.findByLabelText("Delete")).toBeTruthy();
    expect(mocks.postLog).not.toHaveBeenCalled();
  });

  it("names the category on the confirmation", async () => {
    stubTelegram();
    render(<TelegramApp />);

    fireEvent.click(await screen.findByText("To office"));

    // The button's own label is not proof of where the row landed, so the confirmation says.
    expect(await screen.findByText(/to Transportation/)).toBeTruthy();
  });
});

describe("TelegramApp: an unsettled write", () => {
  it("keeps the key pinned and offers a retry when the outcome is unknown", async () => {
    stubTelegram();
    mocks.postLog.mockRejectedValue(new TgRequestError("Server error", 500));
    render(<TelegramApp />);

    fireEvent.click(await screen.findByText("To office"));

    expect(await screen.findByText("That last one may not have saved")).toBeTruthy();
    expect(window.sessionStorage.getItem("tg:pending-log")).toBeTruthy();
  });

  it("replays the same key on retry rather than minting a new one", async () => {
    // The whole point of the pin: a fresh key on a write that may have committed writes the
    // transaction twice.
    stubTelegram();
    mocks.postLog.mockRejectedValue(new TgRequestError("Server error", 500));
    render(<TelegramApp />);

    fireEvent.click(await screen.findByText("To office"));
    await screen.findByText("That last one may not have saved");

    const firstKey = mocks.postLog.mock.calls.at(-1)![1].clientBatchId;
    mocks.postLog.mockResolvedValue(logResult({ replayed: true }));

    fireEvent.click(screen.getByText("Retry"));

    await waitFor(() => expect(mocks.postLog).toHaveBeenCalledTimes(2));
    expect(mocks.postLog.mock.calls.at(-1)![1].clientBatchId).toBe(firstKey);
  });

  it("drops the key when the server refused before writing", async () => {
    // A 4xx is raised before the route opens a transaction, so nothing was written and the entry
    // is free to be corrected and sent again as a new intent.
    stubTelegram();
    mocks.postLog.mockRejectedValue(new TgRequestError("Amount must be greater than 0", 400));
    render(<TelegramApp />);

    fireEvent.click(await screen.findByText("To office"));

    expect(await screen.findByText("Amount must be greater than 0")).toBeTruthy();
    expect(screen.queryByText("That last one may not have saved")).toBeNull();
    expect(window.sessionStorage.getItem("tg:pending-log")).toBeNull();
  });

  it("treats a request that never came back as unknown", async () => {
    // `fetch` rejecting means the server's answer is unknowable, not that nothing happened.
    stubTelegram();
    mocks.postLog.mockRejectedValue(new TgRequestError("Check your connection and try again.", 0));
    render(<TelegramApp />);

    fireEvent.click(await screen.findByText("To office"));

    expect(await screen.findByText("That last one may not have saved")).toBeTruthy();
  });

  it("offers a restored pin on mount rather than replaying it", async () => {
    // Telegram can reload the webview mid-save. Auto-replaying would write a row for someone who
    // may have deliberately backed out, so the retry is offered and never taken automatically.
    window.sessionStorage.setItem(
      "tg:pending-log",
      JSON.stringify({
        clientBatchId: "11111111-2222-4333-8444-555555555555",
        description: "fare to office",
        amount: 38,
        type: "EXPENSE",
      })
    );
    stubTelegram();
    render(<TelegramApp />);

    expect(await screen.findByText("That last one may not have saved")).toBeTruthy();
    expect(mocks.postLog).not.toHaveBeenCalled();
  });

  it("clears the pin once a write lands", async () => {
    stubTelegram();
    render(<TelegramApp />);

    fireEvent.click(await screen.findByText("To office"));

    await waitFor(() => expect(window.sessionStorage.getItem("tg:pending-log")).toBeNull());
  });
});
