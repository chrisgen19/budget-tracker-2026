import { CalendarClock, Camera, CreditCard, Receipt, Send, Sparkles, Terminal } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { TransactionSource } from "@prisma/client";

interface TransactionRowBadgesProps {
  /** Set when the row came from a scanned receipt that was itemised across categories. */
  receiptGroupId?: string | null;
  /** Set when the row was created by paying a recurring bill. */
  billId?: string | null;
  /** Where the row was created, from `transactions.created_via`. */
  createdVia?: TransactionSource;
  /** The credit card this purchase was paid with. A card payment is never a transaction. */
  creditAccount?: { name: string; color: string } | null;
  /** Set when a receipt photo is attached to the row. */
  receiptPhotoId?: string | null;
  /**
   * `"chip"` (default) prints each marker as a labelled chip beside the title. `"icon"` prints
   * glyphs only, for the meta line on phones, where a "Photo" chip cost the title most of its
   * width on a 390px screen. The name moves into the accessible label either way.
   */
  variant?: "chip" | "icon";
}

/** A glyph-only marker: the meaning lives in `aria-label` and `title`, not in the shape. */
function IconMarker({
  icon: Icon,
  label,
  className = "text-warm-400",
  color,
}: {
  icon: LucideIcon;
  label: string;
  className?: string;
  color?: string;
}) {
  return (
    <span
      title={label}
      aria-label={label}
      role="img"
      className={`shrink-0 inline-flex items-center ${className}`}
    >
      <Icon className="w-3 h-3" style={color ? { color } : undefined} />
    </span>
  );
}

/** Provenance markers, identical in both variants since they were already icon-only. */
function ProvenanceMarker({ createdVia }: { createdVia?: TransactionSource }) {
  if (createdVia === "MCP") {
    return <IconMarker icon={Sparkles} label="Added by Claude" className="text-amber-dark" />;
  }
  if (createdVia === "TELEGRAM") return <IconMarker icon={Send} label="Added via Telegram" />;
  if (createdVia === "DENSE") {
    return <IconMarker icon={Terminal} label="Added from the desktop review app" />;
  }
  return null;
}

/**
 * The small markers that sit beside a transaction's description.
 *
 * Extracted from the transactions page so they can be tested: the page renders them inline, and
 * exercising them there would mean mounting the whole route with its providers, router and query
 * client to assert on one span.
 *
 * Provenance is icon-only while the other two carry text. Each remote source gets its own glyph:
 * they all arrive through the same endpoint, so a single marker would have made the Telegram
 * bot's rows claim Claude wrote them. A row is already crowded on a narrow
 * screen, and unlike "Itemized" and "Bill" this one is answering a question most rows do not
 * raise, so it earns less space. The meaning lives in the accessible name rather than the glyph.
 */
export function TransactionRowBadges({
  receiptGroupId,
  billId,
  createdVia,
  creditAccount,
  receiptPhotoId,
  variant = "chip",
}: TransactionRowBadgesProps) {
  if (variant === "icon") {
    return (
      <>
        {receiptPhotoId && <IconMarker icon={Camera} label="Photo attached" />}
        {receiptGroupId && (
          <IconMarker icon={Receipt} label="Itemized receipt" className="text-amber-dark" />
        )}
        {billId && <IconMarker icon={CalendarClock} label="Bill payment" className="text-income" />}
        {creditAccount && (
          <IconMarker
            icon={CreditCard}
            label={`Paid with ${creditAccount.name}`}
            color={creditAccount.color}
          />
        )}
        <ProvenanceMarker createdVia={createdVia} />
      </>
    );
  }

  return (
    <>
      {receiptGroupId && (
        <span className="shrink-0 inline-flex items-center gap-0.5 bg-amber-light/60 text-amber-dark text-[10px] font-medium px-1.5 py-0.5 rounded">
          <Receipt className="w-2.5 h-2.5" />
          Itemized
        </span>
      )}
      {receiptPhotoId && (
        <span className="shrink-0 inline-flex items-center gap-0.5 bg-cream-200 text-warm-500 text-[10px] font-medium px-1.5 py-0.5 rounded">
          <Camera className="w-2.5 h-2.5" />
          Photo
        </span>
      )}
      {billId && (
        <span className="shrink-0 inline-flex items-center gap-0.5 bg-income-light text-income text-[10px] font-medium px-1.5 py-0.5 rounded">
          <CalendarClock className="w-2.5 h-2.5" />
          Bill
        </span>
      )}
      {/* Names the card the purchase was made on, since a card chip alone does not say which. */}
      {creditAccount && (
        <span
          title={`Paid with ${creditAccount.name}`}
          className="shrink-0 inline-flex max-w-[9rem] items-center gap-0.5 bg-cream-100 text-warm-500 text-[10px] font-medium px-1.5 py-0.5 rounded"
        >
          <CreditCard className="w-2.5 h-2.5 shrink-0" style={{ color: creditAccount.color }} />
          <span className="truncate">{creditAccount.name}</span>
        </span>
      )}
      <ProvenanceMarker createdVia={createdVia} />
    </>
  );
}
