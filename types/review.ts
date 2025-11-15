// レビュー関連の型定義

export interface Review {
  id: string;
  carId: string;
  userName: string;
  rating: number; // 1-5
  comment: string;
  createdAt: string; // ISO 8601 形式
}

export interface ReviewStats {
  averageRating: number;
  totalReviews: number;
  ratingDistribution: {
    5: number;
    4: number;
    3: number;
    2: number;
    1: number;
  };
}

export interface ReviewFormData {
  userName: string;
  rating: number;
  comment: string;
}
