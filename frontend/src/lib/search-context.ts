'use client';

import { createContext, useContext } from 'react';

/** Shares the global search box value between the nav and the inbox view. */
export const SearchContext = createContext<{ query: string; setQuery: (v: string) => void }>({
  query: '',
  setQuery: () => undefined,
});

export const useSearch = () => useContext(SearchContext);
