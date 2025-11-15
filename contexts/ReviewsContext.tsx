'use client';

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { Review, ReviewStats, ReviewFormData } from '@/types/review';

interface ReviewsContextType {
  reviews: Review[];
  addReview: (carId: string, formData: ReviewFormData) => void;
  getReviewsByCarId: (carId: string) => Review[];
  getReviewStats: (carId: string) => ReviewStats;
}

const ReviewsContext = createContext<ReviewsContextType | undefined>(undefined);

export function ReviewsProvider({ children }: { children: ReactNode }) {
  const [reviews, setReviews] = useState<Review[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);

  // ローカルストレージから読み込み
  useEffect(() => {
    const stored = localStorage.getItem('carReviews');
    if (stored) {
      try {
        setReviews(JSON.parse(stored));
      } catch (e) {
        console.error('Failed to parse reviews from localStorage', e);
      }
    }
    setIsLoaded(true);
  }, []);

  // ローカルストレージに保存
  useEffect(() => {
    if (isLoaded) {
      localStorage.setItem('carReviews', JSON.stringify(reviews));
    }
  }, [reviews, isLoaded]);

  // レビューを追加
  const addReview = (carId: string, formData: ReviewFormData) => {
    const newReview: Review = {
      id: `review-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      carId,
      userName: formData.userName,
      rating: formData.rating,
      comment: formData.comment,
      createdAt: new Date().toISOString(),
    };

    setReviews((prev) => [newReview, ...prev]);
  };

  // 特定の車のレビューを取得
  const getReviewsByCarId = (carId: string): Review[] => {
    return reviews
      .filter((review) => review.carId === carId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  };

  // レビュー統計を取得
  const getReviewStats = (carId: string): ReviewStats => {
    const carReviews = getReviewsByCarId(carId);
    const totalReviews = carReviews.length;

    if (totalReviews === 0) {
      return {
        averageRating: 0,
        totalReviews: 0,
        ratingDistribution: { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 },
      };
    }

    const ratingDistribution = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
    let totalRating = 0;

    carReviews.forEach((review) => {
      totalRating += review.rating;
      ratingDistribution[review.rating as keyof typeof ratingDistribution]++;
    });

    return {
      averageRating: totalRating / totalReviews,
      totalReviews,
      ratingDistribution,
    };
  };

  return (
    <ReviewsContext.Provider
      value={{
        reviews,
        addReview,
        getReviewsByCarId,
        getReviewStats,
      }}
    >
      {children}
    </ReviewsContext.Provider>
  );
}

export function useReviews() {
  const context = useContext(ReviewsContext);
  if (context === undefined) {
    throw new Error('useReviews must be used within a ReviewsProvider');
  }
  return context;
}
