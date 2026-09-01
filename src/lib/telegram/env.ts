/**
 * An environment variable, with blank treated as unset.
 *
 * `??` only catches `undefined`, and a Coolify field or a `.env.example` line left as `""` is an
 * empty string. That made `TELEGRAM_CURRENCY_SYMBOL=""` render every amount with no symbol, and
 * `TELEGRAM_TZ_OFFSET=""` silently mean UTC, since `Number("")` is a perfectly finite 0.
 */
export const env = (name: string): string | undefined => {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
};
