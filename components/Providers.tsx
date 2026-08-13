'use client';

import { FavoritesProvider } from '@/contexts/FavoritesContext';

export default function Providers({ children }: { children: React.ReactNode }) {
  return <FavoritesProvider>{children}</FavoritesProvider>;
}
