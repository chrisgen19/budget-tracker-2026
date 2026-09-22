import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FeaturesForm } from "@/components/profile/features-form";

const mocks = vi.hoisted(() => ({ savePreference: vi.fn(), user: {} as Record<string, unknown> }));

vi.mock("@/components/user-provider", () => ({ useUser: () => ({ user: mocks.user }) }));
vi.mock("@/hooks/use-save-preference", () => ({ useSavePreference: () => mocks.savePreference }));
vi.mock("@/components/pwa/install-app-card", () => ({ InstallAppCard: () => null }));

beforeEach(() => {
  mocks.savePreference.mockResolvedValue(true);
  mocks.user = {
    receiptScanEnabled: false,
    transactionLayout: "infinite",
    transactionAmountAutofocus: true,
    defaultLabelType: "EXPENSE",
    emailBillReminders: false,
    emailVerified: true,
    telegramPromptAvailable: true,
    telegramDailyPrompt: true,
    telegramDailyPromptTime: "20:00",
    role: "ADMIN",
    roleScanEnabled: true,
  };
});

const timeInput = () => screen.getByLabelText(/send at/i);

describe("the prompt time input", () => {
  // A time input reports "" while the field is cleared and partial values like "20:" while it is
  // being retyped. The server rejects all of them, so sending one produced an error toast for an
  // edit still in progress. Silent before the toast existed; visible after.
  it("does not save while the value is still being edited", () => {
    render(<FeaturesForm />);

    for (const partial of ["", "2", "20:", "20:0"]) {
      fireEvent.change(timeInput(), { target: { value: partial } });
    }

    expect(mocks.savePreference).not.toHaveBeenCalled();
  });

  it("saves once the value is a complete time", () => {
    render(<FeaturesForm />);

    fireEvent.change(timeInput(), { target: { value: "21:30" } });

    expect(mocks.savePreference).toHaveBeenCalledWith(
      "telegramDailyPromptTime",
      "21:30",
      "20:00",
      expect.any(String)
    );
  });
});

describe("the Telegram prompt card", () => {
  // It is bound to the account owning the bot's MCP token; everyone else must not see a toggle
  // that would send a message to somebody else's chat.
  it("is hidden from an account that does not own the bot", () => {
    mocks.user = { ...mocks.user, telegramPromptAvailable: false };
    render(<FeaturesForm />);
    expect(screen.queryByText(/Telegram Evening Prompt/i)).toBeNull();
  });

  it("is shown to the owner", () => {
    render(<FeaturesForm />);
    expect(screen.queryByText(/Telegram Evening Prompt/i)).not.toBeNull();
  });
});

describe("the Telegram Watchlist digest card", () => {
  const digestSwitch = () => screen.getByRole("switch", { name: /Watchlist Digest/i });

  // Same gate as the evening prompt, for the same reason: the cron sends to the bot's one chat.
  it("is hidden from an account that does not own the bot", () => {
    mocks.user = { ...mocks.user, telegramPromptAvailable: false };
    render(<FeaturesForm />);
    expect(screen.queryByText(/Telegram Watchlist Digest/i)).toBeNull();
  });

  it("switches on through the shared save path", () => {
    mocks.user = { ...mocks.user, telegramWatchlistDigest: false, telegramWatchlistDigestTime: "08:00" };
    render(<FeaturesForm />);
    fireEvent.click(digestSwitch());
    expect(mocks.savePreference).toHaveBeenCalledWith("telegramWatchlistDigest", true, false, expect.any(String));
  });

  it("offers its own send time only while it is on", () => {
    mocks.user = { ...mocks.user, telegramDailyPrompt: false, telegramWatchlistDigest: false };
    render(<FeaturesForm />);
    expect(screen.queryByLabelText(/send at/i)).toBeNull();
  });

  it("saves a complete time and ignores one still being typed", () => {
    mocks.user = {
      ...mocks.user,
      telegramDailyPrompt: false,
      telegramWatchlistDigest: true,
      telegramWatchlistDigestTime: "08:00",
    };
    render(<FeaturesForm />);
    fireEvent.change(timeInput(), { target: { value: "07:" } });
    expect(mocks.savePreference).not.toHaveBeenCalled();
    fireEvent.change(timeInput(), { target: { value: "07:30" } });
    expect(mocks.savePreference).toHaveBeenCalledWith("telegramWatchlistDigestTime", "07:30", "08:00", expect.any(String));
  });
});
