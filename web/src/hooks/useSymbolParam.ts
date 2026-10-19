// Keeps the symbol in the URL (`?symbol=TSLA`). As a result, a user can share a link to a result,
// and the result stays after the page loads again.

import { useCallback, useEffect, useState } from 'react';

const PARAM = 'symbol';

/** Reads the symbol from the URL of the page, or `null` if there is none. The value is not validated. */
function readSymbol(): string | null {
  return new URLSearchParams(window.location.search).get(PARAM);
}

/**
 * Gives the symbol in the URL and a function that changes it.
 * A change adds an entry to the browser history, so the back button shows the previous symbol.
 *
 * The return type is a labelled tuple: an array with exactly two items, a value and a setter,
 * in the same form as React's `useState`.
 */
export function useSymbolParam(): [symbol: string | null, setSymbol: (symbol: string) => void] {
  // `useState` keeps a value between the calls of the component. When the code calls `setSymbolState`,
  // React calls the component again with the new value. With a function as the start value (`readSymbol`),
  // React calls it only one time, when the component starts, not at each call of the component.
  const [symbol, setSymbolState] = useState<string | null>(readSymbol);

  // The back and forward buttons change the URL without a call to `setSymbol`.
  // The browser then sends a `popstate` event, so read the URL again.
  // `useEffect` runs its function after React shows the component. The empty list `[]` means
  // "only one time". The function that it gives back is the clean-up: React calls it when the component
  // goes away, so the listener does not stay after the component.
  useEffect(() => {
    const onPopState = () => {
      setSymbolState(readSymbol());
    };
    window.addEventListener('popstate', onPopState);
    return () => {
      window.removeEventListener('popstate', onPopState);
    };
  }, []);

  // `useCallback` gives the same function object at each call of the component.
  // A new function at each call would make a child component, which gets it as a property, render again.
  const setSymbol = useCallback((next: string) => {
    const url = new URL(window.location.href);
    // Do not add a history entry when the symbol does not change.
    if (url.searchParams.get(PARAM) !== next) {
      url.searchParams.set(PARAM, next);
      // `pushState` changes the URL and adds a history entry, without a new load of the page.
      window.history.pushState(null, '', url);
    }
    setSymbolState(next);
  }, []);

  return [symbol, setSymbol];
}
