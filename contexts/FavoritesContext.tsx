'use client';

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';

interface FavoritesContextType {
  favorites: string[];
  addToFavorites: (carId: string) => void;
  removeFromFavorites: (carId: string) => void;
  isFavorite: (carId: string) => boolean;
  toggleFavorite: (carId: string) => void;
}

const FavoritesContext = createContext<FavoritesContextType | undefined>(undefined);

export function FavoritesProvider({ children }: { children: ReactNode }) {
  const [favorites, setFavorites] = useState<string[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    // ローカルストレージから読み込み
    const stored = localStorage.getItem('favorites');
    if (stored) {
      setFavorites(JSON.parse(stored));
    }
    setIsLoaded(true);
  }, []);

  useEffect(() => {
    // ローカルストレージに保存
    if (isLoaded) {
      localStorage.setItem('favorites', JSON.stringify(favorites));
    }
  }, [favorites, isLoaded]);

  const addToFavorites = (carId: string) => {
    setFavorites((prev) => {
      if (prev.includes(carId)) return prev;
      return [...prev, carId];
    });
  };

  const removeFromFavorites = (carId: string) => {
    setFavorites((prev) => prev.filter((id) => id !== carId));
  };

  const isFavorite = (carId: string) => {
    return favorites.includes(carId);
  };

  const toggleFavorite = (carId: string) => {
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
