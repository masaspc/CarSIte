'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createGrade, updateGrade } from '@/app/actions/cars';
import { FEATURE_COLUMNS, type FeatureColumn } from '@/db/schema';
import type { GradeInput } from '@/lib/validation';
import type { ModelOption } from '@/db/admin-queries';

interface CarFormProps {
  initialData?: GradeInput & { id: string };
  mode: 'add' | 'edit';
  models: ModelOption[];
}

const FEATURE_LABEL: Record<string, string> = {
  standard: '標準装備',
  option: 'オプション',
  none: '設定なし',
  unknown: '不明',
};

// 装備は feature_availability の4値で管理する。boolean には戻さない
const FEATURE_NAME: Record<FeatureColumn, string> = {
  collisionMitigationBrake: '衝突被害軽減ブレーキ',
  falseStartSuppression: '誤発進抑制機能',
  laneDepartureWarning: '車線逸脱警報',
  laneKeepingAssist: '車線維持支援',
  adaptiveCruiseControl: 'アダプティブクルーズコントロール',
  blindSpotMonitor: 'ブラインドスポットモニター',
  camera360: '360度カメラ',
  parkingAssist: '駐車支援システム',
  navigation: 'カーナビ',
  etc: 'ETC',
  backCamera: 'バックカメラ',
  powerSeat: 'パワーシート',
  seatHeater: 'シートヒーター',
  steeringHeater: 'ステアリングヒーター',
  autoAircon: 'オートエアコン',
  ledHeadlight: 'LEDヘッドライト',
  smartKey: 'スマートキー',
  powerBackDoor: 'パワーバックドア',
  handsFreeBackDoor: 'ハンズフリーバックドア',
  sunroof: 'サンルーフ',
};

const SAFETY_FEATURES: FeatureColumn[] = [
  'collisionMitigationBrake', 'falseStartSuppression', 'laneDepartureWarning',
  'laneKeepingAssist', 'adaptiveCruiseControl', 'blindSpotMonitor',
  'camera360', 'parkingAssist',
];

const COMFORT_FEATURES: FeatureColumn[] = [
  'navigation', 'etc', 'backCamera', 'powerSeat', 'seatHeater', 'steeringHeater',
  'autoAircon', 'ledHeadlight', 'smartKey', 'powerBackDoor', 'handsFreeBackDoor', 'sunroof',
];

const featureDefaults = Object.fromEntries(
  FEATURE_COLUMNS.map((column) => [column, 'unknown']),
) as Record<FeatureColumn, GradeInput[FeatureColumn]>;

const emptyGrade: GradeInput = {
  modelId: '', name: '', slug: '', price: 0, releaseDate: null, discontinuedAt: null,
  engineType: 'ガソリン', driveSystem: 'FF', transmission: null, seating: 5,
  displacement: null, weight: null, wltcMode: null, cruisingRange: null,
  ecoCarTax: false, airbags: null, ...featureDefaults,
};

export default function CarForm({ initialData, mode, models }: CarFormProps) {
  const router = useRouter();
  const [formData, setFormData] = useState<GradeInput>(initialData ?? emptyGrade);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const set = <K extends keyof GradeInput>(key: K, value: GradeInput[K]) =>
    setFormData((current) => ({ ...current, [key]: value }));
  const nullableNumber = (value: string) => (value === '' ? null : Number(value));

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setIsSubmitting(true);
    try {
      if (mode === 'add') await createGrade(formData);
      else if (initialData) await updateGrade(initialData.id, formData);
      router.push('/admin');
      router.refresh();
    } catch (error) {
      alert(error instanceof Error ? error.message : '保存に失敗しました');
    } finally {
      setIsSubmitting(false);
    }
  };

  const renderFeatureSelect = (column: FeatureColumn) => (
    <label key={column} className="block text-sm font-medium">
      {FEATURE_NAME[column]}
      <select
        value={formData[column]}
        onChange={(e) => set(column, e.target.value as GradeInput[FeatureColumn])}
        className="mt-1 w-full px-3 py-2 border rounded"
      >
        {(['unknown', 'standard', 'option', 'none'] as const).map((value) => (
          <option key={value} value={value}>{FEATURE_LABEL[value]}</option>
        ))}
      </select>
    </label>
  );

  return (
    <form onSubmit={handleSubmit} className="space-y-8 bg-white shadow-md rounded-lg p-6">
      <div>
        <h2 className="text-xl font-bold mb-4">基本情報</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <label className="block text-sm font-medium">
            車種 *
            <select
              required
              disabled={mode === 'edit'}
              value={formData.modelId}
              onChange={(e) => set('modelId', e.target.value)}
              className="mt-1 w-full px-3 py-2 border rounded disabled:bg-gray-100"
            >
              <option value="" disabled>選択してください</option>
              {models.map((m) => (
                <option key={m.id} value={m.id}>{m.manufacturer} {m.name}（{m.bodyType}）</option>
              ))}
            </select>
          </label>
          <Field label="グレード名" required value={formData.name} onChange={(v) => set('name', v)} />
          {/* slug は作成時にだけ決められる。公開URL・共有された /compare のURL・
              訪問者の localStorage のお気に入りがこの値を参照しているため、
              あとから変えると保存済みのリンクが黙って壊れる。
              サーバ側 (updateGrade) でも変更を拒否する（フォームを信用しない） */}
          <div>
            <Field
              label="slug"
              required
              readOnly={mode === 'edit'}
              value={formData.slug}
              onChange={(v) => set('slug', v)}
              placeholder="g-package"
            />
            <p className="mt-1 text-xs text-gray-500">
              {mode === 'edit'
                ? 'slug は作成後に変更できません。共有URLと訪問者のお気に入りがこの値を参照しているため、変更すると保存済みのリンクが壊れます。'
                : 'あとから変更できません。公開URLの一部になります。'}
            </p>
          </div>
          <NumberField label="価格（円）" required value={formData.price} onChange={(v) => set('price', Number(v))} />
          <Field label="発売年月" value={formData.releaseDate ?? ''} placeholder="2026-08" onChange={(v) => set('releaseDate', v || null)} />
          <Field label="販売終了年月" value={formData.discontinuedAt ?? ''} placeholder="YYYY-MM" onChange={(v) => set('discontinuedAt', v || null)} />
          <NumberField label="乗車定員" required value={formData.seating} onChange={(v) => set('seating', Number(v))} />
          <NumberField label="エアバッグ数" value={formData.airbags ?? ''} onChange={(v) => set('airbags', nullableNumber(v))} />
        </div>
      </div>

      <div>
        <h2 className="text-xl font-bold mb-4">エンジン・駆動</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Select label="エンジン" value={formData.engineType} options={['ガソリン', 'ハイブリッド', 'EV', 'ディーゼル', 'PHEV']} onChange={(v) => set('engineType', v as GradeInput['engineType'])} />
          <Select label="駆動方式" value={formData.driveSystem} options={['FF', 'FR', '4WD', 'MR', 'RR']} onChange={(v) => set('driveSystem', v as GradeInput['driveSystem'])} />
          <Field label="トランスミッション" value={formData.transmission ?? ''} onChange={(v) => set('transmission', v || null)} />
          <NumberField label="排気量 (cc)" value={formData.displacement ?? ''} onChange={(v) => set('displacement', nullableNumber(v))} />
          <NumberField label="重量 (kg)" value={formData.weight ?? ''} onChange={(v) => set('weight', nullableNumber(v))} />
        </div>
      </div>

      <div>
        <h2 className="text-xl font-bold mb-4">燃費</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <NumberField label="WLTC燃費 (km/L)" step="0.1" value={formData.wltcMode ?? ''} onChange={(v) => set('wltcMode', nullableNumber(v))} />
          <NumberField label="航続距離 (km)" value={formData.cruisingRange ?? ''} onChange={(v) => set('cruisingRange', nullableNumber(v))} />
          <label className="flex items-center gap-2 self-end py-2">
            <input type="checkbox" checked={formData.ecoCarTax} onChange={(e) => set('ecoCarTax', e.target.checked)} />
            エコカー減税対象
          </label>
        </div>
      </div>

      <div>
        <h2 className="text-xl font-bold mb-4">安全装備</h2>
        <p className="text-xs text-gray-500 mb-2">4値（標準装備／オプション／設定なし／不明）で管理します。不明のままでも保存できます。</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {SAFETY_FEATURES.map(renderFeatureSelect)}
        </div>
      </div>

      <div>
        <h2 className="text-xl font-bold mb-4">快適装備</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {COMFORT_FEATURES.map(renderFeatureSelect)}
        </div>
      </div>

      <div className="flex justify-end gap-3">
        <button type="button" onClick={() => router.back()} className="px-6 py-2 bg-gray-200 text-gray-700 rounded hover:bg-gray-300">キャンセル</button>
        <button disabled={isSubmitting} className="px-6 py-2 bg-primary-600 text-white rounded hover:bg-primary-700 disabled:opacity-50">
          {isSubmitting ? '保存中...' : mode === 'add' ? '追加する' : '更新する'}
        </button>
      </div>
    </form>
  );
}

function Field({ label, onChange, ...props }: Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange'> & { label: string; onChange: (value: string) => void }) {
  return (
    <label className="block text-sm font-medium">
      {label}
      {/* readOnly の欄（編集時の slug）は見た目でも編集不可と分かるようにする */}
      <input {...props} onChange={(e) => onChange(e.target.value)} className="mt-1 w-full px-3 py-2 border rounded focus:ring-2 focus:ring-primary-500 read-only:bg-gray-100 read-only:text-gray-600" />
    </label>
  );
}

function NumberField(props: Omit<React.ComponentProps<typeof Field>, 'type'>) {
  return <Field {...props} type="number" />;
}

function Select({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (value: string) => void }) {
  return (
    <label className="block text-sm font-medium">
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)} className="mt-1 w-full px-3 py-2 border rounded focus:ring-2 focus:ring-primary-500">
        {options.map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
    </label>
  );
}
