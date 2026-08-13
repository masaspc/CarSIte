import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getPublishedModel } from '@/db/queries';
import GradeSpecTable from '@/components/GradeSpecTable';
import PriceHistoryChart from '@/components/PriceHistoryChart';

type Params = { params: Promise<{ manufacturer: string; model: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { manufacturer, model } = await params;
  const detail = await getPublishedModel(manufacturer, model);
  if (!detail) return { title: '車両が見つかりません' };

  const title = `${detail.model.manufacturer} ${detail.model.name}`;
  return {
    title: `${title} | 日本車比較サイト`,
    description: detail.model.description ?? undefined,
    openGraph: { title, description: detail.model.description ?? undefined },
  };
}

export default async function ModelPage({ params }: Params) {
  const { manufacturer, model } = await params;
  const detail = await getPublishedModel(manufacturer, model);
  if (!detail) notFound();

  const cheapest = detail.grades[0];

  return (
    <div className="bg-gray-50 min-h-screen py-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <p className="text-primary-600 font-semibold">{detail.model.manufacturer}</p>
        <h1 className="text-4xl font-bold mb-2">{detail.model.name}</h1>
        <p className="text-gray-600 mb-8">{detail.model.description}</p>

        <section className="bg-white rounded-lg shadow-md p-6 mb-8">
          <h2 className="text-2xl font-bold mb-4">グレード（{detail.grades.length}件）</h2>
          <p className="text-sm text-gray-600 mb-4">
            最安グレードは {cheapest.name}（¥{cheapest.price.toLocaleString()}）です。
          </p>
          {/* 全グレードを横並びで比較する。装備が unknown の項目は「−」を出し、
              「装備なし」と誤読させない */}
          <GradeSpecTable grades={detail.grades} />
        </section>

        {detail.priceHistory.length > 0 && (
          <section className="bg-white rounded-lg shadow-md p-6 mb-8">
            <PriceHistoryChart
              history={detail.priceHistory.map((p) => ({ date: p.date, price: p.price }))}
              model={`${detail.model.manufacturer} ${detail.model.name}`}
            />
          </section>
        )}
      </div>
    </div>
  );
}
