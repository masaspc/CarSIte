'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createGrade, updateGrade } from '@/app/actions/cars';
import type { GradeInput } from '@/lib/validation';

interface CarFormProps {
  initialData?: GradeInput & { id: string };
  mode: 'add' | 'edit';
}

const featureDefaults = {
  collisionMitigationBrake: 'unknown', falseStartSuppression: 'unknown', laneDepartureWarning: 'unknown',
  laneKeepingAssist: 'unknown', adaptiveCruiseControl: 'unknown', blindSpotMonitor: 'unknown',
  camera360: 'unknown', parkingAssist: 'unknown', navigation: 'unknown', etc: 'unknown',
  backCamera: 'unknown', powerSeat: 'unknown', seatHeater: 'unknown', steeringHeater: 'unknown',
  autoAircon: 'unknown', ledHeadlight: 'unknown', smartKey: 'unknown', powerBackDoor: 'unknown',
  handsFreeBackDoor: 'unknown', sunroof: 'unknown',
} as const;

const emptyGrade: GradeInput = {
  modelId: '', name: '', slug: '', price: 0, releaseDate: null, discontinuedAt: null,
  engineType: 'ガソリン', driveSystem: 'FF', transmission: null, seating: 5,
  displacement: null, weight: null, wltcMode: null, cruisingRange: null,
  ecoCarTax: false, airbags: null, ...featureDefaults,
};

export default function CarForm({ initialData, mode }: CarFormProps) {
  const router = useRouter();
  const [formData, setFormData] = useState<GradeInput>(initialData ?? emptyGrade);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const set = <K extends keyof GradeInput>(key: K, value: GradeInput[K]) =>
    setFormData((current) => ({ ...current, [key]: value }));
  const nullableNumber = (value: string) => value === '' ? null : Number(value);

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

  return (
    <form onSubmit={handleSubmit} className="space-y-6 bg-white shadow-md rounded-lg p-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label="車種ID (UUID)" required value={formData.modelId} disabled={mode === 'edit'} onChange={(v) => set('modelId', v)} />
        <Field label="グレード名" required value={formData.name} onChange={(v) => set('name', v)} />
        <Field label="slug" required value={formData.slug} onChange={(v) => set('slug', v)} />
        <NumberField label="価格（円）" required value={formData.price} onChange={(v) => set('price', Number(v))} />
        <Field label="発売年月" value={formData.releaseDate ?? ''} placeholder="2026-08" onChange={(v) => set('releaseDate', v || null)} />
        <Field label="販売終了年月" value={formData.discontinuedAt ?? ''} placeholder="YYYY-MM" onChange={(v) => set('discontinuedAt', v || null)} />
        <Select label="エンジン" value={formData.engineType} options={['ガソリン', 'ハイブリッド', 'EV', 'ディーゼル', 'PHEV']} onChange={(v) => set('engineType', v as GradeInput['engineType'])} />
        <Select label="駆動方式" value={formData.driveSystem} options={['FF', 'FR', '4WD', 'MR', 'RR']} onChange={(v) => set('driveSystem', v as GradeInput['driveSystem'])} />
        <Field label="トランスミッション" value={formData.transmission ?? ''} onChange={(v) => set('transmission', v || null)} />
        <NumberField label="乗車定員" value={formData.seating} onChange={(v) => set('seating', Number(v))} />
        <NumberField label="排気量 (cc)" value={formData.displacement ?? ''} onChange={(v) => set('displacement', nullableNumber(v))} />
        <NumberField label="重量 (kg)" value={formData.weight ?? ''} onChange={(v) => set('weight', nullableNumber(v))} />
        <NumberField label="WLTC燃費" step="0.1" value={formData.wltcMode ?? ''} onChange={(v) => set('wltcMode', nullableNumber(v))} />
        <NumberField label="航続距離 (km)" value={formData.cruisingRange ?? ''} onChange={(v) => set('cruisingRange', nullableNumber(v))} />
        <NumberField label="エアバッグ数" value={formData.airbags ?? ''} onChange={(v) => set('airbags', nullableNumber(v))} />
        <label className="flex items-center gap-2 self-end py-2"><input type="checkbox" checked={formData.ecoCarTax} onChange={(e) => set('ecoCarTax', e.target.checked)} />エコカー減税対象</label>
      </div>
      <div className="flex justify-end gap-3">
        <button type="button" onClick={() => router.back()} className="px-6 py-2 bg-gray-200 rounded">キャンセル</button>
        <button disabled={isSubmitting} className="px-6 py-2 bg-primary-600 text-white rounded disabled:opacity-50">{isSubmitting ? '保存中...' : '保存する'}</button>
      </div>
    </form>
  );
}

function Field({ label, onChange, ...props }: Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange'> & { label: string; onChange: (value: string) => void }) {
  return <label className="block text-sm font-medium">{label}<input {...props} onChange={(e) => onChange(e.target.value)} className="mt-1 w-full px-3 py-2 border rounded" /></label>;
}

function NumberField(props: Omit<React.ComponentProps<typeof Field>, 'type'>) {
  return <Field {...props} type="number" />;
}

function Select({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (value: string) => void }) {
  return <label className="block text-sm font-medium">{label}<select value={value} onChange={(e) => onChange(e.target.value)} className="mt-1 w-full px-3 py-2 border rounded">{options.map((option) => <option key={option}>{option}</option>)}</select></label>;
}
