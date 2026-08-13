'use client';

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { FAVORITES_KEY, parseStored, type GradeRef } from '@/lib/compare-store';

interface FavoritesContextType {
  favorites: GradeRef[];
  addToFavorites: (ref: GradeRef) => void;
  removeFromFavorites: (ref: GradeRef) => void;
  isFavorite: (ref: GradeRef) => boolean;
  toggleFavorite: (ref: GradeRef) => void;
}

const FavoritesContext = createContext<FavoritesContextType | undefined>(undefined);

export function FavoritesProvider({ children }: { children: ReactNode }) {
  const [favorites, setFavorites] = useState<GradeRef[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    // ローカルストレージから読み込み
    setFavorites(parseStored(localStorage.getItem(FAVORITES_KEY)));
    setIsLoaded(true);
  }, []);

  useEffect(() => {
    // ローカルストレージに保存
    if (isLoaded) {
      localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites));
    }
  }, [favorites, isLoaded]);

  const addToFavorites = (carId: GradeRef) => {
    setFavorites((prev) => {
      if (prev.includes(carId)) return prev;
      return [...prev, carId];
    });
  };

  const removeFromFavorites = (carId: GradeRef) => {
    setFavorites((prev) => prev.filter((id) => id !== carId));
  };

  const isFavorite = (carId: GradeRef) => {
    return favorites.includes(carId);
  };

  const toggleFavorite = (carId: GradeRef) => {
    if (isFavorite(carId)) {
      removeFromFavorites(carId);
    } else {
      addToFavorites(carId);
    }
  };

  return (
    <FavoritesContext.Provider
      value={{
        favorites,
        addToFavorites,
        removeFromFavorites,
        isFavorite,
        toggleFavorite,
      }}
    >
      {children}
    </FavoritesContext.Provider>
  );
}

export function useFavorites() {
  const context = useContext(FavoritesContext);
  if (context === undefined) {
    throw new Error('useFavorites must be used within a FavoritesProvider');
  }
  return context;
}
