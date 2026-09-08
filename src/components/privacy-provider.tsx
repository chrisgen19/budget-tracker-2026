"use client";

import { createContext, useContext, useEffect, useRef, useState, useCallback } from "react";

import { useToast } from "@/components/ui/toast";
interface PrivacyContextValue {
  hideAmounts: boolean;
  toggleHideAmounts: () => void;
}

const PrivacyContext = createContext<PrivacyContextValue>({
  hideAmounts: false,
  toggleHideAmounts: () => {},
});

export const usePrivacy = () => useContext(PrivacyContext);

export function PrivacyProvider({
  children,
  initialHideAmounts = false,
}: {
  children: React.ReactNode;
  /**
   * The stored preference, read server-side in `(app)/layout.tsx`.
   *
   * Without it this started at `false` and only learned the truth after a client fetch, so a
   * user who asked for their amounts hidden saw the real figures on screen on every page load
   * until the round trip landed. A flash of the exact thing the setting exists to hide.
   */
  initialHideAmounts?: boolean;
}) {
  const [hideAmounts, setHideAmounts] = useState(initialHideAmounts);
  const { showToast } = useToast();

  /**
   * Set the moment the user presses the control, so the mount read below can stand down.
   *
   * A ref rather than state: nothing renders from it, and it has to be readable by a promise
   * that was created before the press, which a state value captured in that closure would not be.
   */
  const toggledLocally = useRef(false);

  /**
   * The tail of the write queue, so two quick presses cannot commit out of order.
   *
   * Each press fired its own PATCH with nothing sequencing them, and `PATCH /api/preferences`
   * ends in an unconditional `prisma.user.update` - so a double press could land as
   * `{true}` then `{false}` on the wire and commit the other way round, leaving the database
   * holding the value the user pressed *away* from while the screen shows the one they chose.
   * It survives until the next load, and then the load resolves it the wrong way.
   *
   * Ordering the writes is not on its own enough to make the rollback correct - see
   * `confirmedValue` below.
   */
  const writeQueue = useRef<Promise<void>>(Promise.resolve());

  /**
   * The last value the server is known to hold, and the only safe thing to roll back to.
   *
   * Rolling back to "whatever this press flipped away from" is right only while that value was
   * itself confirmed. Queue two presses and fail both, and the second restores the *first*
   * press's optimistic value - one the database never accepted - leaving the screen inverted
   * against storage. From hidden, pressing show then hide ends with the amounts on screen while
   * the stored preference still says hide, which is the failure this whole setting exists to
   * prevent.
   *
   * Seeded from the server-rendered value, then moved only by a read or a write that landed.
   */
  const confirmedValue = useRef(initialHideAmounts);

  /**
   * Counts presses, so a write can tell whether it still speaks for the user.
   *
   * Only the newest press describes what they want. A superseded write's failure says nothing
   * about that - they have pressed past it - and applying its rollback discards a later press
   * that is already on screen and still queued to be saved. Press three times inside one round
   * trip and let only the first write fail: its rollback wins the screen, the two writes behind
   * it store the opposite, and the amounts sit visible over a database that says hide.
   *
   * It also settles how many complaints one bad moment earns. Three queued failures are one
   * failed save from the user's side, not three.
   */
  const pressCount = useRef(0);

  /**
   * Reconcile with the stored value once on mount - unless the user has already spoken.
   *
   * The seed is only as fresh as the server render, so this catches a change made on another
   * device in between. But the control now sits in the app chrome, on screen from the first
   * paint, so pressing it while this request is still in flight is ordinary rather than
   * contrived: the PATCH stores the new value, then this resolves carrying the old one and puts
   * it back, leaving the UI disagreeing with the database until the next reload. Re-hiding is
   * merely confusing. The other direction puts amounts the user just deliberately hid back on
   * screen, which is the one thing this setting exists to stop.
   *
   * A failed read leaves the seeded value alone, which is the right answer now that there is
   * one: the server rendered this page with the stored preference moments ago.
   */
  useEffect(() => {
    let abandoned = false;

    const fetchPreference = async () => {
      try {
        const res = await fetch("/api/preferences");
        if (!res.ok) return;
        const data = await res.json();
        if (abandoned || toggledLocally.current) return;
        confirmedValue.current = data.hideAmounts;
        setHideAmounts(data.hideAmounts);
      } catch {
        // Keep what the server gave us.
      }
    };

    fetchPreference();
    return () => {
      abandoned = true;
    };
  }, []);

  /**
   * Toggle hidden amounts, and put it back if the save does not land.
   *
   * This did not check the response at all: the switch flipped, the request went out, and a
   * failure left the UI disagreeing with the database until the next reload - so amounts could
   * read as hidden on a page that would show them again on refresh. Worse than the profile
   * toggles, which at least reverted.
   *
   * Not routed through `useSavePreference` because `hideAmounts` lives in this provider's own
   * state rather than in `UserInfo`, so there is nothing for that hook to apply. Same rule,
   * applied where the state actually is.
   */
  const toggleHideAmounts = useCallback(async () => {
    const newValue = !hideAmounts;
    const press = (pressCount.current += 1);
    toggledLocally.current = true;
    setHideAmounts(newValue);

    /** Only the newest press still describes what the user wants; an older one has been answered. */
    const rollBack = (message: string) => {
      if (press !== pressCount.current) return;
      setHideAmounts(confirmedValue.current);
      showToast(message, "error");
    };

    const write = writeQueue.current.then(async () => {
      try {
        const res = await fetch("/api/preferences", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ hideAmounts: newValue }),
        });

        if (res.ok) {
          confirmedValue.current = newValue;
        } else {
          // The two failures need different advice: the server refused this value, versus the
          // request never arrived. Telling someone to check their connection when the server
          // rejected the value sends them to look at the wrong thing.
          rollBack("Could not save that. Please try again.");
        }
      } catch {
        rollBack("Could not save that. Check your connection.");
      }
    });

    // The queue must survive a rejection, or one failure strands every later press behind a
    // promise that never settles. Every failure mode above is already handled inside `write`.
    writeQueue.current = write.catch(() => {});
    await write;
  }, [hideAmounts, showToast]);

  return (
    <PrivacyContext.Provider value={{ hideAmounts, toggleHideAmounts }}>
      {children}
    </PrivacyContext.Provider>
  );
}
