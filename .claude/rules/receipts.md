---
paths:
  - src/lib/receipt-scan.ts
  - src/lib/receipt-date.ts
  - src/lib/receipt-guard.ts
  - src/lib/scan-quota.ts
  - src/lib/exif-date.ts
  - src/app/api/receipts
  - src/components/scan-receipt-sheet.tsx
  - src/components/multi-scan-review.tsx
  - src/components/scan-provider.tsx
  - src/components/profile/features-form.tsx
  - src/app/api/preferences
  - src/lib/telegram/bot.ts
---

# Receipts

## Key Patterns

- **Receipt scanning** is opt-in per user — toggled in Profile Settings > Features; uses Gemini AI for OCR and per-category itemization
- **Receipt year repair** (`src/lib/receipt-date.ts`): `checkReceiptDate` normally warns about a suspicious year without touching it, but overrides one readable case — when the OCR year disagrees with the photo's while the month and day match it *exactly*. That signature is a misread digit, not an old receipt, since reading a different date wrong almost never lands on the photo's month and day; it was seen in production as `08/26/2026` read back as `2023-08-26`. A repair always sets `dateWarning` and reports `repairedFromYear`, which the review renders as "year corrected from 2023" and `scan_receipt` states in prose, because an inference the user cannot see is one they cannot undo. Deliberately narrow: "same month" or "within a few days" would start rewriting dates that were read correctly. Note this is the one place a *readable* receipt date is influenced by the photo date, narrowing the rule below
- **Photo capture dates** (`src/lib/exif-date.ts`): `readPhotoTakenAt` pulls EXIF `DateTimeOriginal` out of JPEG/HEIC bytes with no dependency, since the tag is fixed-width ASCII inside a standard TIFF block that both formats embed. The Telegram bot has no `File.lastModified` to read, so an unreadable receipt date used to fall back to *today*, putting a receipt photographed days earlier on the day it was uploaded. EXIF timestamps carry no timezone by specification, which is exactly the offset-less shape `resolveTransactionDate` wants; appending a `Z` would claim UTC. It survives only when the image is sent as a **file**, since Telegram re-encodes photos and strips metadata. Used whole rather than as a bare date, so the timestamp is real and label schedules can run against it instead of an invented clock
- **Receipt captions** — free text sent with a photo reaches `scanReceipt` as a `caption` and is quoted into the prompt as a *hint*, capped at `MAX_CAPTION_CHARS`. Deliberately not applied afterwards as a description override: "here you go" is an ordinary thing to send with a photo, and pasting it over a correctly-read merchant name is worse than ignoring it, whereas the model can weigh it against what it reads. It is also the only route by which the caption can reach `categoryId`, which is the field OCR most often gets wrong and which a post-hoc description swap could never help. The receipt wins on conflict, and the prompt tells the model to read `amount` and `date` from the image alone. That is a steer, not a guarantee — prose cannot bind a model, and a caption naming a figure could in principle be echoed into `amount`. What actually protects those two fields is the confirmation step, which receipt scanning has always required for precisely this reason: OCR on a crumpled phone photo is where a wrong amount comes from, so nothing is written until the user has seen it. The caption sits *below* the category rules and above only the response format, so it cannot appear to re-scope the rules it must not override. The Telegram review says "I used your caption as a hint" when one was sent, on the same principle as the repaired receipt year: an inference the user cannot see is one they cannot undo. "The receipt wins" is scoped to what the receipt actually *prints* — the amount, the date, and a merchant it names. A wallet transfer prints an account holder and a reference number and nothing about the purchase, so there the caption is the only description that exists and the user's own wording is kept, place names the image cannot corroborate included: `Tiendesitas Yosh's Pickleball fee` came back as `Yosh's Pickleball fee`, which is a row nobody can place a month later. The prompt also says an instruction inside a caption ("category fun") is not description text and that removing one must not take the purchase with it

- **Receipt scan quota** (`src/lib/scan-quota.ts`) — a credit is reserved *before* the Gemini call and settled after: `SUCCESS` spends it, `FAILED` refunds it, so users are never charged for a scan they can't use. Reservations serialise per user with a Postgres advisory lock (a bare count-then-insert cannot enforce a limit under READ COMMITTED). Because refunds mean the monthly limit no longer bounds API spend, a rolling attempt rate limit does. `FAILED` rows are kept, not deleted, so refunded attempts still count toward it
- **Receipt itemization** — multi-scan groups transactions by `receiptGroupId`; per-transaction `receiptBreakdown` JSON stores individual line items for each category
