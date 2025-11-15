'use client';

import { useState } from 'react';
import { useReviews } from '@/contexts/ReviewsContext';
import { ReviewFormData } from '@/types/review';

interface ReviewSectionProps {
  carId: string;
  carName: string;
}

export default function ReviewSection({ carId, carName }: ReviewSectionProps) {
  const { getReviewsByCarId, getReviewStats, addReview } = useReviews();
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState<ReviewFormData>({
    userName: '',
    rating: 5,
    comment: '',
  });

  const reviews = getReviewsByCarId(carId);
  const stats = getReviewStats(carId);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.userName.trim() || !formData.comment.trim()) {
      alert('お名前とレビュー内容を入力してください。');
      return;
    }

    addReview(carId, formData);
    setFormData({ userName: '', rating: 5, comment: '' });
    setShowForm(false);
    alert('レビューを投稿しました！');
  };

  const renderStars = (rating: number, interactive: boolean = false) => {
    return (
      <div className="flex gap-1">
        {[1, 2, 3, 4, 5].map((star) => (
          <span
            key={star}
            className={`text-xl ${
              star <= rating ? 'text-yellow-400' : 'text-gray-300'
            } ${interactive ? 'cursor-pointer hover:text-yellow-500' : ''}`}
            onClick={
              interactive
                ? () => setFormData({ ...formData, rating: star })
                : undefined
            }
          >
            ★
          </span>
        ))}
      </div>
    );
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('ja-JP', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  return (
    <div className="mt-12 border-t pt-8">
      <h2 className="text-2xl font-bold mb-6">ユーザーレビュー</h2>

      {/* レビュー統計 */}
      <div className="bg-gray-50 p-6 rounded-lg mb-6">
        <div className="flex items-center gap-6 mb-4">
          <div className="text-center">
            <div className="text-4xl font-bold text-primary-600">
              {stats.averageRating > 0 ? stats.averageRating.toFixed(1) : '-'}
            </div>
            <div className="flex justify-center mt-2">
              {renderStars(Math.round(stats.averageRating))}
            </div>
            <div className="text-sm text-gray-600 mt-1">
              {stats.totalReviews}件のレビュー
            </div>
          </div>

          {stats.totalReviews > 0 && (
            <div className="flex-1">
              {[5, 4, 3, 2, 1].map((rating) => (
                <div key={rating} className="flex items-center gap-2 mb-1">
                  <span className="text-sm w-8">{rating}★</span>
                  <div className="flex-1 bg-gray-200 h-2 rounded">
                    <div
                      className="bg-yellow-400 h-2 rounded"
                      style={{
                        width: `${
                          stats.totalReviews > 0
                            ? (stats.ratingDistribution[
                                rating as keyof typeof stats.ratingDistribution
                              ] /
                                stats.totalReviews) *
                              100
                            : 0
                        }%`,
                      }}
                    />
                  </div>
                  <span className="text-sm w-8 text-right">
                    {stats.ratingDistribution[rating as keyof typeof stats.ratingDistribution]}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <button
          onClick={() => setShowForm(!showForm)}
          className="mt-4 px-6 py-2 bg-primary-600 text-white rounded hover:bg-primary-700 transition"
        >
          {showForm ? 'キャンセル' : 'レビューを書く'}
        </button>
      </div>

      {/* レビュー投稿フォーム */}
      {showForm && (
        <form onSubmit={handleSubmit} className="bg-white border p-6 rounded-lg mb-6">
          <h3 className="font-bold text-lg mb-4">{carName}のレビューを投稿</h3>

          <div className="mb-4">
            <label className="block text-sm font-medium mb-2">お名前</label>
            <input
              type="text"
              value={formData.userName}
              onChange={(e) =>
                setFormData({ ...formData, userName: e.target.value })
              }
              className="w-full px-4 py-2 border rounded focus:ring-2 focus:ring-primary-500"
              placeholder="山田太郎"
              required
            />
          </div>

          <div className="mb-4">
            <label className="block text-sm font-medium mb-2">評価</label>
            {renderStars(formData.rating, true)}
          </div>

          <div className="mb-4">
            <label className="block text-sm font-medium mb-2">レビュー内容</label>
            <textarea
              value={formData.comment}
              onChange={(e) =>
                setFormData({ ...formData, comment: e.target.value })
              }
              className="w-full px-4 py-2 border rounded focus:ring-2 focus:ring-primary-500"
              rows={5}
              placeholder="この車の良い点や気になる点など、自由にご記入ください。"
              required
            />
          </div>

          <div className="flex gap-3">
            <button
              type="submit"
              className="px-6 py-2 bg-primary-600 text-white rounded hover:bg-primary-700 transition"
            >
              投稿する
            </button>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="px-6 py-2 bg-gray-200 text-gray-700 rounded hover:bg-gray-300 transition"
            >
              キャンセル
            </button>
          </div>
        </form>
      )}

      {/* レビュー一覧 */}
      <div className="space-y-4">
        {reviews.length === 0 ? (
          <p className="text-gray-500 text-center py-8">
            まだレビューがありません。最初のレビューを投稿してみませんか？
          </p>
        ) : (
          reviews.map((review) => (
            <div key={review.id} className="border p-4 rounded-lg">
              <div className="flex items-start justify-between mb-2">
                <div>
                  <div className="font-medium">{review.userName}</div>
                  <div className="flex items-center gap-2 mt-1">
                    {renderStars(review.rating)}
                    <span className="text-sm text-gray-500">
                      {formatDate(review.createdAt)}
                    </span>
                  </div>
                </div>
              </div>
              <p className="text-gray-700 mt-3 whitespace-pre-wrap">
                {review.comment}
              </p>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
