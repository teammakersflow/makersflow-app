export function isNetworkError(err: any): boolean {
  const status = Number(err?.status);
  const msg = String(err?.message ?? '').toLowerCase();
  const code = String(err?.code ?? '').toLowerCase();

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
