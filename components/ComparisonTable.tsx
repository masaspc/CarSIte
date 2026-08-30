'use client';

import { Fragment } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import type { ComparisonRow } from '@/db/queries';
import type { GradeRef } from '@/lib/compare-store';
import { buildComparison, countDifferent, visibleSections } from '@/lib/comparison-diff';

interface Props {
  grades: ComparisonRow[];
  onRemove: (ref: GradeRef) => void;
  showAll: boolean;
  onToggleShowAll: () => void;
}

interface GradeImages {
  exterior?: string[];
}

function gradeRef({ grade, manufacturerSlug, modelSlug }: ComparisonRow): GradeRef {
  return `${manufacturerSlug}/${modelSlug}/${grade.slug}`;
}

export default function ComparisonTable({ grades, onRemove, showAll, onToggleShowAll }: Props) {
  if (grades.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-600 mb-4">比較する車両が選択されていません</p>
        <Link
          href="/search"
          className="inline-block bg-primary-600 text-white py-2 px-6 rounded hover:bg-primary-700 transition-colors"
        >
          車を探す
        </Link>
      </div>
    );
  }

  const sections = buildComparison(grades);
  const { different, unknown, total } = countDifferent(sections);
  const visible = visibleSections(sections, showAll);
  const canToggle = grades.length > 1;

  return (
    <div>
      <div className="mb-4 flex items-center gap-4">
        <button
          type="button"
          role="switch"
          aria-checked={!showAll}
          onClick={onToggleShowAll}
          disabled={!canToggle}
          className="shrink-0 rounded-full border border-primary-600 px-4 py-2 text-sm font-semibold text-primary-700 transition-colors hover:bg-primary-50 disabled:cursor-not-allowed disabled:border-gray-300 disabled:text-gray-400 disabled:hover:bg-transparent"
        >
          {showAll ? 'すべて表示中' : '違いのみ表示中'}
        </button>
        <p className="text-sm text-gray-700">
          {canToggle ? (
            <>
              {total}項目中 {different}項目が異なります
              {unknown > 0 && `（うち${unknown}項目は情報が不足しています）`}
            </>
          ) : (
            'もう1台追加すると違いを表示できます'
          )}
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse bg-white shadow-md rounded-lg overflow-hidden">
          <thead>
            <tr className="bg-primary-600 text-white">
              <th className="py-4 px-4 text-left sticky left-0 bg-primary-600">項目</th>
              {grades.map((row) => {
                const images = row.grade.images as GradeImages | null;
                const cover = images?.exterior?.[0];
                return (
                  <th key={row.grade.id} className="py-4 px-4 min-w-[200px]">
                    <div className="space-y-2">
                      <div className="aspect-video bg-gray-200 rounded overflow-hidden relative">
                        {cover ? (
                          <Image
                            src={cover}
                            alt={`${row.manufacturer} ${row.modelName}`}
                            fill
                            sizes="(max-width: 768px) 100vw, 33vw"
                            className="object-cover"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-gray-400 text-xs">
                            画像なし
                          </div>
                        )}
                      </div>
                      <div>
                        <p className="text-sm">{row.manufacturer}</p>
                        <p className="font-bold">{row.modelName}</p>
                        <p className="text-xs">{row.grade.name}</p>
                        {/* 同名グレードを見分けるために要る。プリウスには Z が3つある */}
                        <p className="text-xs opacity-80">{row.grade.powertrain}</p>
                        <p className="text-xs opacity-80">{row.grade.driveSystem}</p>
                      </div>
                      <button
                        onClick={() => onRemove(gradeRef(row))}
                        className="text-xs bg-red-500 hover:bg-red-600 text-white py-1 px-3 rounded"
                      >
                        削除
                      </button>
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {visible.map((section) => (
              <Fragment key={section.label}>
                <tr className="bg-gray-100">
                  <td colSpan={grades.length + 1} className="py-2 px-4 font-bold">
                    {section.label}
                  </td>
                </tr>
                {section.rows.map((row) => (
                  <tr
                    className={`border-b ${showAll && row.state === 'different' ? 'bg-amber-50' : ''}`}
                    key={row.label}
                  >
                    <td className="py-3 px-4 font-semibold bg-gray-50 sticky left-0">{row.label}</td>
                    {row.cells.map((cell, idx) => (
                      <td key={idx} className="py-3 px-4 text-center">
                        {cell.text}
                      </td>
                    ))}
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
