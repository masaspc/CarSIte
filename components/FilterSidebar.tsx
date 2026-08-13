'use client';

import { useRouter } from 'next/navigation';
// 選択肢はDBの enum 定義をそのまま読む。UI側で書き写すと、
// DBに無い値で絞り込めたり、追加した値が選べなかったりする
import { BODY_TYPES, DRIVE_SYSTEMS, ENGINE_TYPES } from '@/db/enums';

interface FilterSidebarProps {
  // URLSearchParams はServer→Clientのpropsシリアライズを越えられない
  // （クラスインスタンスのメソッドが失われる）ので配列で受け取る
  entries: [string, string][];
  /** 公開中の車種を持つメーカー名。文字列配列なのでRSCシリアライズの罠は無い */
  manufacturers: string[];
}

export default function FilterSidebar({ entries, manufacturers }: FilterSidebarProps) {
  const router = useRouter();
  const params = new URLSearchParams(entries);

  const selectedManufacturers = params.getAll('manufacturer');
  const selectedBodyTypes = params.getAll('bodyType');
  const selectedEngineTypes = params.getAll('engineType');
  const driveSystem = params.get('driveSystem') ?? '';
  const priceMinYen = params.get('priceMin');
  const priceMaxYen = params.get('priceMax');
  const fuelEfficiencyMin = params.get('fuelEfficiencyMin') ?? '';

  // URLが唯一の真実の源。既存のパラメータをコピーしてから1つだけ差し替えるので、
  // キーワードなど他の条件を保持したままフィルタを更新できる。
  const navigate = (next: URLSearchParams) => {
    next.delete('page'); // 条件が変わったら1ページ目に戻す
    const query = next.toString();
    router.push(query ? `/search?${query}` : '/search');
  };

  const update = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value === null || value === '') next.delete(key);
    else next.set(key, value);
    navigate(next);
  };

  const toggleMulti = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    const current = next.getAll(key);
    next.delete(key);
    const updated = current.includes(value)
      ? current.filter((v) => v !== value)
      : [...current, value];
    for (const v of updated) next.append(key, v);
    navigate(next);
  };

  const handleReset = () => {
    router.push('/search');
  };

  return (
    <div className="bg-white p-6 rounded-lg shadow-md" key={params.toString()}>
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-xl font-bold">絞り込み</h2>
        <button onClick={handleReset} className="text-sm text-primary-600 hover:text-primary-700">
          リセット
        </button>
      </div>

      {/* メーカー。公開データが0件のときは一覧も空になる（正しい挙動）ので
          見出しごと非表示にする */}
      {manufacturers.length > 0 && (
        <div className="mb-6">
          <h3 className="font-semibold mb-3">メーカー</h3>
          <div className="space-y-2 max-h-48 overflow-y-auto">
            {manufacturers.map((manufacturer) => (
              <label key={manufacturer} className="flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={selectedManufacturers.includes(manufacturer)}
                  onChange={() => toggleMulti('manufacturer', manufacturer)}
                  className="mr-2"
                />
                <span className="text-sm">{manufacturer}</span>
              </label>
            ))}
          </div>
        </div>
      )}

      {/* ボディタイプ */}
      <div className="mb-6">
        <h3 className="font-semibold mb-3">ボディタイプ</h3>
        <div className="space-y-2">
          {BODY_TYPES.map((bodyType) => (
            <label key={bodyType} className="flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={selectedBodyTypes.includes(bodyType)}
                onChange={() => toggleMulti('bodyType', bodyType)}
                className="mr-2"
              />
              <span className="text-sm">{bodyType}</span>
            </label>
          ))}
        </div>
      </div>

      {/* エンジンタイプ */}
      <div className="mb-6">
        <h3 className="font-semibold mb-3">エンジンタイプ</h3>
        <div className="space-y-2">
          {ENGINE_TYPES.map((engineType) => (
            <label key={engineType} className="flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={selectedEngineTypes.includes(engineType)}
                onChange={() => toggleMulti('engineType', engineType)}
                className="mr-2"
              />
              <span className="text-sm">{engineType}</span>
            </label>
          ))}
        </div>
      </div>

      {/* 価格範囲。ラベルは「万円」、値は円に変換してURLへ入れる */}
      <div className="mb-6">
        <h3 className="font-semibold mb-3">価格帯（万円）</h3>
        <div className="flex gap-2 items-center">
          <input
            type="number"
            placeholder="下限"
            defaultValue={priceMinYen === null ? '' : Number(priceMinYen) / 10_000}
            onBlur={(e) => {
              const man = e.target.value;
              update('priceMin', man ? String(Number(man) * 10_000) : null);
            }}
            className="w-full px-3 py-2 border rounded text-sm"
          />
          <span>〜</span>
          <input
            type="number"
            placeholder="上限"
            defaultValue={priceMaxYen === null ? '' : Number(priceMaxYen) / 10_000}
            onBlur={(e) => {
              const man = e.target.value;
              update('priceMax', man ? String(Number(man) * 10_000) : null);
            }}
            className="w-full px-3 py-2 border rounded text-sm"
          />
        </div>
      </div>

      {/* 燃費 */}
      <div className="mb-6">
        <h3 className="font-semibold mb-3">燃費（km/L以上）</h3>
        <input
          type="number"
          placeholder="例: 20"
          defaultValue={fuelEfficiencyMin}
          onBlur={(e) => update('fuelEfficiencyMin', e.target.value || null)}
          className="w-full px-3 py-2 border rounded text-sm"
        />
      </div>

      {/* 駆動方式 */}
      <div className="mb-6">
        <h3 className="font-semibold mb-3">駆動方式</h3>
        <select
          value={driveSystem}
          onChange={(e) => update('driveSystem', e.target.value || null)}
          className="w-full px-3 py-2 border rounded text-sm"
        >
          <option value="">全て</option>
          {DRIVE_SYSTEMS.map((ds) => (
            <option key={ds} value={ds}>
              {ds}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
