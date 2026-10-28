import { useEffect } from 'react';

// Sequential requests; pause while the page is hidden and abort on view/filter changes.
export function usePolling(callback, delay, enabled = true) {
  useEffect(() => {
    if (!enabled) return undefined;
    let timer;
    let controller;
    let disposed = false;

    const poll = async () => {
      clearTimeout(timer);
      controller?.abort();
      if (document.hidden || disposed) return;
      const request = new AbortController();
      controller = request;
      try {
        await callback(request.signal);
      } finally {
        if (!disposed && !request.signal.aborted && !document.hidden && delay !== null) {
          timer = setTimeout(poll, delay);
        }
      }
    };
    const onVisibility = () => {
      clearTimeout(timer);
      controller?.abort();
      if (!document.hidden) void poll();
    };
    void poll();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      disposed = true;
      clearTimeout(timer);
      controller?.abort();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [callback, delay, enabled]);
}
