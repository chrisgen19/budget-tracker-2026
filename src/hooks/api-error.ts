/**
 * The server answered and said no.
 *
 * A request that never arrived rejects with `fetch`'s own error instead, so a caller can still
 * tell "the server refused this, try again" from "check your connection". Several screens give
 * different advice for the two, and they lost the distinction the moment the request moved out
 * of the component, unless the refusal has a type of its own.
 */
export class ApiRefusedError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = "ApiRefusedError";
  }
}

/** Build the refusal for a non-2xx response, using the body's `error` string when it has one. */
export const refusalFrom = async (res: Response, fallback: string): Promise<ApiRefusedError> => {
  const body = (await res.json().catch(() => null)) as { error?: unknown } | null;
  const message = typeof body?.error === "string" && body.error ? body.error : fallback;
  return new ApiRefusedError(message, res.status);
};
