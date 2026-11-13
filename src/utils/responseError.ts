// Server error paths respond with { error: string }; non-JSON bodies
// (e.g. an nginx HTML error page) yield null so callers fall back to the status.
export function readResponseError(response: Response): Promise<string | null> {
  return response
    .json()
    .then((body) => (typeof body?.error === 'string' ? body.error : null))
    .catch(() => null);
}
