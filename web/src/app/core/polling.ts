import { DestroyRef, inject } from '@angular/core';

/**
 * Call `fn` now and every `ms` while the page is visible. Family members are
 * all tapping at once; a short poll keeps everyone's screen in sync without a
 * socket layer.
 */
export function usePolling(fn: () => void | Promise<void>, ms = 12_000): void {
  const destroy = inject(DestroyRef);
  const tick = () => {
    if (document.visibilityState === 'visible') void fn();
  };
  void fn();
  const handle = setInterval(tick, ms);
  document.addEventListener('visibilitychange', tick);
  destroy.onDestroy(() => {
    clearInterval(handle);
    document.removeEventListener('visibilitychange', tick);
  });
}
