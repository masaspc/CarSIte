'use client';

import { PriceHistoryPoint } from '@/types/car';

interface PriceHistoryChartProps {
  history: PriceHistoryPoint[];
  model: string;
}

function formatPrice(price: number): string {
  return `¥${price.toLocaleString()}`;
}

export default function PriceHistoryChart({ history, model }: PriceHistoryChartProps) {
  if (!history || history.length === 0) {
    return null;
  }

  // データを日付順にソート
  const sortedHistory = [...history].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
  );

  // 最小値と最大値を計算
  const prices = sortedHistory.map((p) => p.price);
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const priceRange = maxPrice - minPrice;

  // チャートの設定
  const width = 800;
  const height = 300;
  const padding = { top: 40, right: 40, bottom: 60, left: 80 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  // 座標計算
  const getX = (index: number) => {
    return padding.left + (chartWidth / (sortedHistory.length - 1)) * index;
  };

  const getY = (price: number) => {
    if (priceRange === 0) return padding.top + chartHeight / 2;
    return padding.top + chartHeight - ((price - minPrice) / priceRange) * chartHeight;
  };

  // SVGパスを生成
  const pathData = sortedHistory
    .map((point, index) => {
      const x = getX(index);
      const y = getY(point.price);
      return `${index === 0 ? 'M' : 'L'} ${x} ${y}`;
    })
    .join(' ');

  // 日付フォーマット
  const formatDate = (dateStr: string) => {
    const [year, month] = dateStr.split('-');
    return `${year}年${parseInt(month)}月`;
  };

  return (
    <div className="mt-8 p-6 bg-gray-50 rounded-lg">
      <h3 className="text-lg font-bold mb-4">価格推移</h3>
      <div className="bg-white p-4 rounded border overflow-x-auto">
        <svg width={width} height={height} className="mx-auto">
          {/* グリッドライン */}
          {[0, 1, 2, 3, 4].map((i) => {
            const y = padding.top + (chartHeight / 4) * i;
            const price = maxPrice - (priceRange / 4) * i;
            return (
              <g key={i}>
                <line
                  x1={padding.left}
                  y1={y}
                  x2={width - padding.right}
                  y2={y}
                  stroke="#e5e7eb"
                  strokeWidth="1"
                />
                <text
                  x={padding.left - 10}
                  y={y + 5}
                  textAnchor="end"
                  className="text-xs fill-gray-600"
                >
                  {Math.round(price / 10000)}万円
                </text>
              </g>
            );
          })}

          {/* X軸ラベル */}
          {sortedHistory.map((point, index) => {
            const x = getX(index);
            return (
              <text
                key={index}
                x={x}
                y={height - padding.bottom + 30}
                textAnchor="middle"
                className="text-xs fill-gray-600"
              >
                {formatDate(point.date)}
              </text>
            );
          })}

          {/* 折れ線グラフ */}
          <path
            d={pathData}
            fill="none"
            stroke="#2563eb"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* データポイント */}
          {sortedHistory.map((point, index) => {
            const x = getX(index);
            const y = getY(point.price);
            return (
              <g key={index}>
                <circle cx={x} cy={y} r="5" fill="#2563eb" />
                <circle cx={x} cy={y} r="3" fill="white" />
              </g>
            );
          })}

          {/* タイトル */}
          <text
            x={width / 2}
            y={20}
            textAnchor="middle"
            className="text-sm font-semibold fill-gray-700"
          >
            {model} の価格推移
          </text>
        </svg>

        {/* データテーブル */}
        <div className="mt-6">
          <table className="w-full text-sm">
            <thead className="bg-gray-100">
              <tr>
                <th className="px-4 py-2 text-left">時期</th>
                <th className="px-4 py-2 text-right">価格</th>
                <th className="px-4 py-2 text-right">変動</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {sortedHistory.map((point, index) => {
                const prevPrice = index > 0 ? sortedHistory[index - 1].price : point.price;
                const change = point.price - prevPrice;
                const changePercent = prevPrice > 0 ? ((change / prevPrice) * 100).toFixed(1) : '0';

                return (
                  <tr key={index}>
                    <td className="px-4 py-2">{formatDate(point.date)}</td>
                    <td className="px-4 py-2 text-right font-semibold">
                      {formatPrice(point.price)}
                    </td>
                    <td className="px-4 py-2 text-right">
                      {index === 0 ? (
                        <span className="text-gray-500">-</span>
                      ) : (
                        <span
                          className={
                            change > 0
                              ? 'text-red-600'
                              : change < 0
                              ? 'text-green-600'
                              : 'text-gray-600'
                          }
                        >
                          {change > 0 ? '+' : ''}
                          {formatPrice(change)} ({changePercent}%)
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
