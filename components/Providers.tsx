'use client';

import { FavoritesProvider } from '@/contexts/FavoritesContext';
import { ReviewsProvider } from '@/contexts/ReviewsContext';

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <FavoritesProvider>
      <ReviewsProvider>{children}</ReviewsProvider>
    </FavoritesProvider>
  );
}
