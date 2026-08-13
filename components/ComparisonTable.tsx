'use client';

import Link from 'next/link';
import type { ComparisonRow } from '@/db/queries';
import type { GradeRef } from '@/lib/compare-store';

interface Props { grades: ComparisonRow[]; onRemove: (ref: GradeRef) => void }

export default function ComparisonTable({ grades, onRemove }: Props) {
  if (grades.length === 0) return <div className="text-center py-12"><p className="text-gray-600 mb-4">比較する車両が選択されていません</p><Link href="/search" className="inline-block bg-primary-600 text-white py-2 px-6 rounded">車を探す</Link></div>;
  const row = (label: string, values: React.ReactNode[]) => <tr className="border-b"><td className="py-3 px-4 font-semibold bg-gray-50 sticky left-0">{label}</td>{values.map((value, index) => <td key={index} className="py-3 px-4 text-center">{value ?? '-'}</td>)}</tr>;

  return <div className="overflow-x-auto"><table className="w-full border-collapse"><thead><tr className="bg-primary-600 text-white"><th className="py-4 px-4 text-left">項目</th>{grades.map(({ grade, manufacturer, modelName, manufacturerSlug, modelSlug }) => {
    const ref = `${manufacturerSlug}/${modelSlug}/${grade.slug}`;
    const images = grade.images as { exterior?: string[] } | null;
    return <th key={grade.id} className="py-4 px-4 min-w-[200px]">{images?.exterior?.[0] && <img src={images.exterior[0]} alt={`${manufacturer} ${modelName}`} className="aspect-video w-full object-cover rounded" />}<p className="text-sm mt-2">{manufacturer}</p><p className="font-bold">{modelName}</p><p className="text-xs">{grade.name}</p><button onClick={() => onRemove(ref)} className="mt-2 text-xs bg-red-500 py-1 px-3 rounded">削除</button></th>;
  })}</tr></thead><tbody>{row('価格', grades.map(({ grade }) => `¥${grade.price.toLocaleString()}`))}{row('ボディタイプ', grades.map(({ bodyType }) => bodyType))}{row('発売年月', grades.map(({ grade }) => grade.releaseDate))}{row('エンジン', grades.map(({ grade }) => grade.engineType))}{row('駆動方式', grades.map(({ grade }) => grade.driveSystem))}{row('トランスミッション', grades.map(({ grade }) => grade.transmission))}{row('乗車定員', grades.map(({ grade }) => `${grade.seating}人`))}{row('WLTC燃費', grades.map(({ grade }) => grade.wltcMode ? `${grade.wltcMode} km/L` : '-'))}</tbody></table></div>;
}
