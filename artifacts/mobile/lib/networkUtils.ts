export function isNetworkError(err: any): boolean {
  const status = Number(err?.status);
  const msg = String(err?.message ?? '').toLowerCase();
  const code = String(err?.code ?? '').toLowerCase();

  // L-20: a real HTTP error response (4xx/5xx other than 408) is not a network
  // failure, even if its message mentions "fetch" or "connection".
  if (Number.isFinite(status) && status >= 400 && status !== 408) return false;

  return (
    status === 0 ||
    status === 408 ||
    err?.name === 'AbortError' ||
    code === 'err_network' ||
    code === 'econnaborted' ||
    code === 'econnrefused' ||
    code === 'enotfound' ||
    code === 'etimedout' ||
    msg.includes('network') ||
    msg.includes('fetch') ||
    msg.includes('unable to connect') ||
    msg.includes('connection') ||
    msg.includes('dns') ||
    msg.includes('timed out') ||
    msg.includes('timeout') ||
    msg.includes('aborted')
  );
}
