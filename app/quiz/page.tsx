'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { BodyType } from '@/db/schema';

interface QuizAnswers {
  purpose?: string;
  budget?: number;
  priority?: string;
  passengers?: number;
  fuelPriority?: boolean;
}

export default function QuizPage() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [answers, setAnswers] = useState<QuizAnswers>({});

  const totalSteps = 5;

  const handleNext = () => {
    if (step < totalSteps) {
      setStep(step + 1);
    } else {
      // 診断結果を基に検索
      generateRecommendation();
    }
  };

  const handleBack = () => {
    if (step > 1) {
      setStep(step - 1);
    }
  };

  const generateRecommendation = () => {
    const params = new URLSearchParams();

    // 用途に基づくボディタイプ。BodyType はDBの enum 由来なので、
    // ここに存在しない表記を書けばコンパイルで落ちる（0件ヒットの検索URLを作らない）
    const appendBodyTypes = (...bodyTypes: BodyType[]) => {
      for (const bodyType of bodyTypes) params.append('bodyType', bodyType);
    };

    if (answers.purpose === 'commute') {
      appendBodyTypes('軽自動車', 'コンパクトカー');
    } else if (answers.purpose === 'family') {
      appendBodyTypes('ミニバン', 'SUV');
    } else if (answers.purpose === 'leisure') {
      appendBodyTypes('SUV', 'ステーションワゴン');
    } else if (answers.purpose === 'driving') {
      appendBodyTypes('スポーツカー', 'セダン');
    }

    // 予算
    if (answers.budget) {
      params.append('priceMax', answers.budget.toString());
    }

    // 燃費重視
    if (answers.fuelPriority) {
      params.append('fuelEfficiencyMin', '20');
    }

    // 乗車定員
    if (answers.passengers && answers.passengers >= 7) {
      params.append('seatingMin', '7');
    }

    router.push(`/search?${params.toString()}`);
  };

  const renderStep = () => {
    switch (step) {
      case 1:
        return (
          <div className="space-y-4">
            <h2 className="text-2xl font-bold mb-6">主な用途は？</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {[
                { value: 'commute', label: '通勤・通学', icon: '🚗' },
                { value: 'family', label: '家族での移動', icon: '👨‍👩‍👧‍👦' },
                { value: 'leisure', label: 'レジャー・アウトドア', icon: '🏕️' },
                { value: 'driving', label: 'ドライビングを楽しむ', icon: '🏎️' },
              ].map((option) => (
                <button
                  key={option.value}
                  onClick={() => {
                    setAnswers({ ...answers, purpose: option.value });
                    handleNext();
                  }}
                  className={`p-6 border-2 rounded-lg hover:border-primary-600 hover:bg-primary-50 transition-all text-left ${
                    answers.purpose === option.value
                      ? 'border-primary-600 bg-primary-50'
                      : 'border-gray-200'
                  }`}
                >
                  <div className="text-4xl mb-2">{option.icon}</div>
                  <div className="font-semibold text-lg">{option.label}</div>
                </button>
              ))}
            </div>
          </div>
        );

      case 2:
        return (
          <div className="space-y-4">
            <h2 className="text-2xl font-bold mb-6">ご予算は？</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {[
                { value: 2000000, label: '200万円以下' },
                { value: 3000000, label: '300万円以下' },
                { value: 4000000, label: '400万円以下' },
                { value: 5000000, label: '500万円以下' },
                { value: 0, label: '予算は気にしない' },
              ].map((option) => (
                <button
                  key={option.value}
                  onClick={() => {
                    setAnswers({
                      ...answers,
                      budget: option.value === 0 ? undefined : option.value,
                    });
                    handleNext();
                  }}
                  className={`p-6 border-2 rounded-lg hover:border-primary-600 hover:bg-primary-50 transition-all ${
                    answers.budget === option.value
                      ? 'border-primary-600 bg-primary-50'
                      : 'border-gray-200'
                  }`}
                >
                  <div className="font-semibold text-lg">{option.label}</div>
                </button>
              ))}
            </div>
          </div>
        );

      case 3:
        return (
          <div className="space-y-4">
            <h2 className="text-2xl font-bold mb-6">重視する点は？</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {[
                { value: 'fuel', label: '燃費性能', icon: '⛽' },
                { value: 'space', label: '広さ・積載性', icon: '📦' },
                { value: 'safety', label: '安全性能', icon: '🛡️' },
                { value: 'performance', label: '走行性能', icon: '⚡' },
              ].map((option) => (
                <button
                  key={option.value}
                  onClick={() => {
                    setAnswers({ ...answers, priority: option.value });
                    handleNext();
                  }}
                  className={`p-6 border-2 rounded-lg hover:border-primary-600 hover:bg-primary-50 transition-all text-left ${
                    answers.priority === option.value
                      ? 'border-primary-600 bg-primary-50'
                      : 'border-gray-200'
                  }`}
                >
                  <div className="text-4xl mb-2">{option.icon}</div>
                  <div className="font-semibold text-lg">{option.label}</div>
                </button>
              ))}
            </div>
          </div>
        );

      case 4:
        return (
          <div className="space-y-4">
            <h2 className="text-2xl font-bold mb-6">乗車人数は？</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {[
                { value: 2, label: '1〜2人' },
                { value: 5, label: '3〜5人' },
                { value: 7, label: '6〜7人' },
                { value: 8, label: '8人以上' },
              ].map((option) => (
                <button
                  key={option.value}
                  onClick={() => {
                    setAnswers({ ...answers, passengers: option.value });
                    handleNext();
                  }}
                  className={`p-6 border-2 rounded-lg hover:border-primary-600 hover:bg-primary-50 transition-all ${
                    answers.passengers === option.value
                      ? 'border-primary-600 bg-primary-50'
                      : 'border-gray-200'
                  }`}
                >
                  <div className="font-semibold text-lg">{option.label}</div>
                </button>
              ))}
            </div>
          </div>
        );

      case 5:
        return (
          <div className="space-y-4">
            <h2 className="text-2xl font-bold mb-6">燃費は重要ですか？</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {[
                { value: true, label: 'はい、燃費は重要です', icon: '✅' },
                { value: false, label: 'いいえ、燃費は気にしません', icon: '❌' },
              ].map((option) => (
                <button
                  key={option.value.toString()}
                  onClick={() => {
                    setAnswers({ ...answers, fuelPriority: option.value });
                    handleNext();
                  }}
                  className={`p-6 border-2 rounded-lg hover:border-primary-600 hover:bg-primary-50 transition-all text-left ${
                    answers.fuelPriority === option.value
                      ? 'border-primary-600 bg-primary-50'
                      : 'border-gray-200'
                  }`}
                >
                  <div className="text-4xl mb-2">{option.icon}</div>
                  <div className="font-semibold text-lg">{option.label}</div>
                </button>
              ))}
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="bg-gray-50 min-h-screen py-8">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="bg-white rounded-lg shadow-md p-8">
          {/* プログレスバー */}
          <div className="mb-8">
            <div className="flex justify-between mb-2">
              <span className="text-sm font-semibold text-gray-600">
                質問 {step} / {totalSteps}
              </span>
              <span className="text-sm font-semibold text-gray-600">
                {Math.round((step / totalSteps) * 100)}%
              </span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div
                className="bg-primary-600 h-2 rounded-full transition-all duration-300"
                style={{ width: `${(step / totalSteps) * 100}%` }}
              ></div>
            </div>
          </div>

          {/* 質問コンテンツ */}
          {renderStep()}

          {/* ナビゲーションボタン */}
          <div className="mt-8 flex justify-between">
            {step > 1 ? (
              <button
                onClick={handleBack}
                className="px-6 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
              >
                戻る
              </button>
            ) : (
              <div></div>
            )}
          </div>
        </div>

        {/* 説明 */}
        <div className="mt-6 text-center text-sm text-gray-600">
          <p>あなたにピッタリの車を見つけるために、いくつか質問にお答えください</p>
        </div>
      </div>
    </div>
  );
}
