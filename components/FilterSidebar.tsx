'use client';

import { useState } from 'react';
import { BodyType, EngineType, DriveSystem } from '@/types/car';

interface FilterSidebarProps {
  manufacturers: string[];
  onFilterChange: (filters: any) => void;
}

export default function FilterSidebar({ manufacturers, onFilterChange }: FilterSidebarProps) {
  const [selectedManufacturers, setSelectedManufacturers] = useState<string[]>([]);
  const [selectedBodyTypes, setSelectedBodyTypes] = useState<BodyType[]>([]);
  const [selectedEngineTypes, setSelectedEngineTypes] = useState<EngineType[]>([]);
  const [priceMin, setPriceMin] = useState<string>('');
  const [priceMax, setPriceMax] = useState<string>('');
  const [fuelEfficiencyMin, setFuelEfficiencyMin] = useState<string>('');
  const [selectedDriveSystem, setSelectedDriveSystem] = useState<DriveSystem | ''>('');

  const bodyTypes: BodyType[] = [
    '軽自動車',
    'コンパクトカー',
    'セダン',
    'ハッチバック',
    'ステーションワゴン',
    'SUV',
    'ミニバン',
    'スポーツカー',
    'クーペ',
  ];

  const engineTypes: EngineType[] = [
    'ガソリン',
    'ハイブリッド',
    'EV',
    'ディーゼル',
    'PHEV',
  ];

  const driveSystems: DriveSystem[] = ['FF', 'FR', '4WD', 'MR', 'RR'];

  const handleManufacturerChange = (manufacturer: string) => {
    const updated = selectedManufacturers.includes(manufacturer)
      ? selectedManufacturers.filter((m) => m !== manufacturer)
      : [...selectedManufacturers, manufacturer];
    setSelectedManufacturers(updated);
    applyFilters({ manufacturers: updated });
  };

  const handleBodyTypeChange = (bodyType: BodyType) => {
    const updated = selectedBodyTypes.includes(bodyType)
      ? selectedBodyTypes.filter((bt) => bt !== bodyType)
      : [...selectedBodyTypes, bodyType];
    setSelectedBodyTypes(updated);
    applyFilters({ bodyTypes: updated });
  };

  const handleEngineTypeChange = (engineType: EngineType) => {
    const updated = selectedEngineTypes.includes(engineType)
      ? selectedEngineTypes.filter((et) => et !== engineType)
      : [...selectedEngineTypes, engineType];
    setSelectedEngineTypes(updated);
    applyFilters({ engineTypes: updated });
  };

  const applyFilters = (updates: any = {}) => {
    onFilterChange({
      manufacturers: updates.manufacturers ?? selectedManufacturers,
      bodyTypes: updates.bodyTypes ?? selectedBodyTypes,
      engineTypes: updates.engineTypes ?? selectedEngineTypes,
      priceMin: priceMin ? parseInt(priceMin) : undefined,
      priceMax: priceMax ? parseInt(priceMax) : undefined,
      fuelEfficiencyMin: fuelEfficiencyMin ? parseFloat(fuelEfficiencyMin) : undefined,
      driveSystem: selectedDriveSystem || undefined,
    });
  };

  const handleReset = () => {
    setSelectedManufacturers([]);
    setSelectedBodyTypes([]);
    setSelectedEngineTypes([]);
    setPriceMin('');
    setPriceMax('');
    setFuelEfficiencyMin('');
    setSelectedDriveSystem('');
    onFilterChange({});
  };

  return (
    <div className="bg-white p-6 rounded-lg shadow-md">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-xl font-bold">絞り込み</h2>
        <button
          onClick={handleReset}
          className="text-sm text-primary-600 hover:text-primary-700"
        >
          リセット
        </button>
      </div>

      {/* メーカー */}
      <div className="mb-6">
        <h3 className="font-semibold mb-3">メーカー</h3>
        <div className="space-y-2 max-h-48 overflow-y-auto">
          {manufacturers.map((manufacturer) => (
            <label key={manufacturer} className="flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={selectedManufacturers.includes(manufacturer)}
                onChange={() => handleManufacturerChange(manufacturer)}
                className="mr-2"
              />
              <span className="text-sm">{manufacturer}</span>
            </label>
          ))}
        </div>
      </div>

      {/* ボディタイプ */}
      <div className="mb-6">
        <h3 className="font-semibold mb-3">ボディタイプ</h3>
        <div className="space-y-2">
          {bodyTypes.map((bodyType) => (
            <label key={bodyType} className="flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={selectedBodyTypes.includes(bodyType)}
                onChange={() => handleBodyTypeChange(bodyType)}
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
          {engineTypes.map((engineType) => (
            <label key={engineType} className="flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={selectedEngineTypes.includes(engineType)}
                onChange={() => handleEngineTypeChange(engineType)}
                className="mr-2"
              />
              <span className="text-sm">{engineType}</span>
            </label>
          ))}
        </div>
      </div>

      {/* 価格範囲 */}
      <div className="mb-6">
        <h3 className="font-semibold mb-3">価格帯（万円）</h3>
        <div className="flex gap-2 items-center">
          <input
            type="number"
            placeholder="下限"
            value={priceMin}
            onChange={(e) => setPriceMin(e.target.value)}
            onBlur={() => applyFilters()}
            className="w-full px-3 py-2 border rounded text-sm"
          />
          <span>〜</span>
          <input
            type="number"
            placeholder="上限"
            value={priceMax}
            onChange={(e) => setPriceMax(e.target.value)}
            onBlur={() => applyFilters()}
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
          value={fuelEfficiencyMin}
          onChange={(e) => setFuelEfficiencyMin(e.target.value)}
          onBlur={() => applyFilters()}
          className="w-full px-3 py-2 border rounded text-sm"
        />
      </div>

      {/* 駆動方式 */}
      <div className="mb-6">
        <h3 className="font-semibold mb-3">駆動方式</h3>
        <select
          value={selectedDriveSystem}
          onChange={(e) => {
            setSelectedDriveSystem(e.target.value as DriveSystem | '');
            applyFilters({ driveSystem: e.target.value || undefined });
          }}
          className="w-full px-3 py-2 border rounded text-sm"
        >
          <option value="">全て</option>
          {driveSystems.map((ds) => (
            <option key={ds} value={ds}>
              {ds}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
