"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Check, Loader2, RotateCw } from "lucide-react";
import {
  TgRequestError,
  fetchBootstrap,
  postLog,
  type Bootstrap,
  type FrequentTile,
  type LogInput,
  type LogResult,
  type TileView,
} from "@/components/telegram/tg-api";
import {
  clearPendingLog,
  newBatchId,
  readPendingLog,
  scopeOf,
  writePendingLog,
  type PendingLog,
} from "@/components/telegram/pending-log";
import {
  useBackButton,
  useHaptics,
  useTelegramWebApp,
  useViewportHeight,
} from "@/components/telegram/use-telegram-webapp";
import { AmountSheet } from "@/components/telegram/amount-sheet";
import { TileGrid } from "@/components/telegram/tile-grid";
import { TileEditor } from "@/components/telegram/tile-editor";

/**
 * The Mini App shell: which screen is showing, and the one write path all of them share.
 *
 * Three screens rather than routes, because Telegram's back button is a single handler and a
 * webview that navigates loses the SDK's state. `screen` is the whole router.
 */
type Screen =
  | { name: "grid" }
  | { name: "pad"; title: string; initial: number | null; input: Omit<LogInput, "clientBatchId"> }
  | { name: "editor" };

export function TelegramApp() {
  const { webApp, initData, resolved } = useTelegramWebApp();
  useViewportHeight(webApp);
  const { tapped, settled } = useHaptics(webApp);

  const [data, setData] = useState<Bootstrap | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [screen, setScreen] = useState<Screen>({ name: "grid" });
  const [busy, setBusy] = useState(false);
  const [logged, setLogged] = useState<LogResult | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  /**
   * A write whose outcome is unknown, pinned so its retry replays the same key.
   *
   * Restored from `sessionStorage` on mount and *offered*, never replayed automatically: Telegram
   * can reload the webview at any moment, and auto-replaying writes a row for someone who may have
   * deliberately backed out.
   */
  const [pending, setPending] = useState<PendingLog | null>(null);

  const load = useCallback(
    (credential: string) => {
      setLoadError(null);
      fetchBootstrap(credential)
        .then(setData)
        .catch((err: unknown) =>
          setLoadError(err instanceof Error ? err.message : "Could not load your buttons.")
        );
    },
    []
  );

  useEffect(() => {
    if (!initData) return;
    setPending(readPendingLog(scopeOf(initData)));
    load(initData);
  }, [initData, load]);

  useBackButton(webApp, {
    visible: screen.name !== "grid",
    onClick: () => setScreen({ name: "grid" }),
  });

  /**
   * The single write path.
   *
   * The key is minted per attempt, held across an *unknown* outcome, and cleared once the write
   * lands or is proven not to have happened. A 4xx means the route refused before opening a
   * transaction, so nothing was written and the key may go; anything else has to be replayed
   * rather than re-attempted with a fresh key, which would duplicate a committed row.
   */
  const submit = useCallback(
    async (input: Omit<LogInput, "clientBatchId">, replayKey?: string) => {
      if (!initData) return;

      // A new tap is refused while an earlier one is unresolved, because there is one pin and a
      // second write would take it. Losing it means the first entry can never be replayed: if it
      // did commit, nothing says so; if it did not, the entry is gone and the user was last told
      // it "may not have saved". Settling one at a time is the only honest order, and the grid is
      // disabled to match so the refusal is never something the user has to discover.
      if (pending && !replayKey) return;

      const clientBatchId = replayKey ?? newBatchId();
      const record: PendingLog = {
        clientBatchId,
        description: input.description,
        amount: input.amount,
        type: input.type ?? "EXPENSE",
        scope: scopeOf(initData),
        ...(input.tileId ? { tileId: input.tileId } : {}),
        ...(input.categoryId ? { categoryId: input.categoryId } : {}),
      };

      setBusy(true);
      setFailure(null);
      // Written before the request, not after it fails: a response lost to a reload never reaches
      // a catch block, and that is precisely the case the pin exists for.
      writePendingLog(record);

      try {
        const result = await postLog(initData, { ...input, clientBatchId });
        clearPendingLog();
        setPending(null);
        setLogged(result);
        setScreen({ name: "grid" });
        settled(true);
        load(initData);
      } catch (err) {
        settled(false);
        const message = err instanceof Error ? err.message : "Could not log that.";

        if (err instanceof TgRequestError && err.wrote === "no") {
          // Refused before anything was written, so the key is dead and the entry is free to be
          // corrected and sent again as a new intent.
          clearPendingLog();
          setPending(null);
          setFailure(message);
        } else {
          // Unknown. The row may exist, so the key stays pinned and the retry replays it.
          setPending(record);
          setFailure(message);
        }
      } finally {
        setBusy(false);
      }
    },
    [initData, load, settled, pending]
  );

  const openTile = (tile: TileView) => {
    tapped();
    const input = { tileId: tile.id, description: tile.description, type: tile.type };

    if (tile.amount === null) {
      setScreen({ name: "pad", title: tile.label, initial: null, input: { ...input, amount: 0 } });
      return;
    }
    void submit({ ...input, amount: tile.amount });
  };

  const openFrequent = (entry: FrequentTile) => {
    tapped();
    const input = {
      description: entry.description,
      type: "EXPENSE" as const,
      categoryId: entry.categoryId,
    };

    // Only a stable amount logs on one tap. Otherwise the pad opens with the suggestion prefilled,
    // because the user may assert a fixed amount and the system may only propose one.
    if (entry.amountIsStable && entry.amount !== null) {
      void submit({ ...input, amount: entry.amount });
      return;
    }
    setScreen({
      name: "pad",
      title: entry.description,
      initial: entry.amount,
      input: { ...input, amount: 0 },
    });
  };

  // Gated on the *credential*, not on whether a WebApp object exists.
  //
  // Those are not the same thing, which an e2e run in a real browser found and jsdom could not:
  // `telegram-web-app.js` loads from Telegram's CDN on any page, and outside a Telegram client it
  // still installs a `window.Telegram.WebApp` whose `initData` is empty. So the object was
  // present, `inTelegram` was true, and there was nothing to authenticate with -- and the guard,
  // which required all three to be absent, fell through to a spinner that never resolved. That is
  // what somebody opening the URL in Safari would have sat looking at.
  //
  // `resolved` separates "no credential" from "the effect has not run yet", so the first client
  // render still matches the server's.
  if (!initData) {
    return resolved ? (
      <Notice title="Open this from Telegram" body="This page needs Telegram to identify you." />
    ) : (
      <Loading />
    );
  }

  if (loadError) {
    return (
      <Notice
        title="Could not load your buttons"
        body={loadError}
        action={initData ? { label: "Try again", onClick: () => load(initData) } : undefined}
      />
    );
  }

  if (!data) return <Loading />;

  if (screen.name === "editor") {
    return (
      <TileEditor
        webApp={webApp}
        initData={initData!}
        tiles={data.tiles}
        categories={data.categories}
        maxTiles={data.limits.maxTiles}
        onChanged={() => load(initData!)}
        onDone={() => setScreen({ name: "grid" })}
      />
    );
  }

  if (screen.name === "pad") {
    return (
      <AmountSheet
        webApp={webApp}
        title={screen.title}
        currency={data.user.currency}
        initial={screen.initial}
        busy={busy}
        // A submit from the pad that fails leaves the pad on screen, so the message has to be
        // rendered here too. Without it the button simply re-enabled and nothing said why.
        failure={failure}
        onSubmit={(amount) => void submit({ ...screen.input, amount })}
      />
    );
  }

  return (
    <>
      {pending ? (
        <PendingBanner
          busy={busy}
          onRetry={() =>
            void submit(
              {
                description: pending.description,
                amount: pending.amount,
                type: pending.type,
                ...(pending.tileId ? { tileId: pending.tileId } : {}),
                ...(pending.categoryId ? { categoryId: pending.categoryId } : {}),
              },
              pending.clientBatchId
            )
          }
        />
      ) : null}

      {failure && !pending ? <FailureBanner message={failure} /> : null}
      {logged ? <LoggedBanner result={logged} currency={data.user.currency} /> : null}

      <TileGrid
        tiles={data.tiles}
        frequent={data.frequent}
        currency={data.user.currency}
        busy={busy || pending !== null}
        onTile={openTile}
        onFrequent={openFrequent}
        onEdit={() => setScreen({ name: "editor" })}
      />

      {/* Stays open after a save rather than calling `close()`. A morning fare and an evening fare
          are one sitting, and closing removes the only surface that can report a failure. */}
      <div className="px-4 pb-6">
        <button
          type="button"
          onClick={() => webApp?.close()}
          className="min-h-11 w-full rounded-2xl border border-warm-200 py-3 text-sm text-warm-600 active:bg-cream-200"
        >
          Done
        </button>
      </div>
    </>
  );
}

function Loading() {
  return (
    <div className="flex min-h-[var(--tg-vh,100dvh)] items-center justify-center">
      <Loader2 className="h-6 w-6 animate-spin text-warm-400" aria-label="Loading" />
    </div>
  );
}

function Notice({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className="flex min-h-[var(--tg-vh,100dvh)] flex-col items-center justify-center gap-3 p-6 text-center">
      <p className="font-display text-lg font-semibold text-warm-800">{title}</p>
      <p className="text-sm text-warm-600">{body}</p>
      {action ? (
        <button
          type="button"
          onClick={action.onClick}
          className="mt-2 min-h-11 rounded-xl bg-amber px-4 py-2 text-sm font-medium text-white"
        >
          {action.label}
        </button>
      ) : null}
    </div>
  );
}

function PendingBanner({ busy, onRetry }: { busy: boolean; onRetry: () => void }) {
  return (
    <div className="m-4 rounded-2xl border border-amber-200 bg-amber-50 p-3">
      <p className="flex items-center gap-2 text-sm font-medium text-amber-900">
        <AlertTriangle className="h-4 w-4" aria-hidden />
        That last one may not have saved
      </p>
      <p className="mt-1 text-xs text-amber-800">
        Retrying is safe: it replays the same entry rather than writing a second one.
      </p>
      <button
        type="button"
        disabled={busy}
        onClick={onRetry}
        className="mt-2 inline-flex min-h-11 items-center gap-2 rounded-xl bg-amber px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <RotateCw className="h-4 w-4" aria-hidden />}
        Retry
      </button>
    </div>
  );
}

function FailureBanner({ message }: { message: string }) {
  return (
    <p className="m-4 rounded-2xl border border-expense-light bg-expense-light/40 p-3 text-sm text-expense-dark">
      {message}
    </p>
  );
}

function LoggedBanner({ result, currency }: { result: LogResult; currency: string }) {
  const amount = new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    maximumFractionDigits: result.amount % 1 === 0 ? 0 : 2,
  }).format(result.amount);

  return (
    <div className="m-4 rounded-2xl border border-income-light bg-income-light/40 p-3">
      <p className="flex items-center gap-2 text-sm font-medium text-income-dark">
        <Check className="h-4 w-4" aria-hidden />
        {result.replayed ? "Already saved" : "Logged"} {amount}
      </p>
      {/* The category is named on every confirmation, not only when it surprised us: the button's
          own label is not proof of where the row landed. */}
      <p className="mt-0.5 text-xs text-warm-600">
        {result.description} to {result.categoryName}
        {result.labels.length > 0 ? ` (${result.labels.join(", ")})` : ""}
      </p>
    </div>
  );
}
