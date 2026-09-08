import { TelegramApp } from "@/components/telegram/telegram-app";

/**
 * The Mini App's entry point.
 *
 * A server component that renders nothing of its own and reads nothing. There is no session at
 * this layer -- the credential arrives client-side from Telegram's SDK -- so any data fetched here
 * would be fetched as nobody. Everything comes over `/api/tg/*` once the page is running.
 */
export default function TelegramQuickLogPage() {
  return <TelegramApp />;
}
