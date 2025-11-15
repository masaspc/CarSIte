import carsData from '@/data/cars.json';
import { Car, FilterParams, SortOption } from '@/types/car';

export const cars: Car[] = carsData as Car[];

export function getAllCars(): Car[] {
  return cars;
}

export function getCarById(id: string): Car | undefined {
  return cars.find((car) => car.id === id);
}

export function filterCars(params: FilterParams): Car[] {
  let filteredCars = [...cars];

  // キーワード検索
  if (params.keyword) {
    const keyword = params.keyword.toLowerCase();
    filteredCars = filteredCars.filter(
      (car) =>
        car.manufacturer.toLowerCase().includes(keyword) ||
        car.model.toLowerCase().includes(keyword) ||
        car.description.toLowerCase().includes(keyword)
    );
  }

  // メーカーでフィルタ
  if (params.manufacturers && params.manufacturers.length > 0) {
    filteredCars = filteredCars.filter((car) =>
      params.manufacturers!.includes(car.manufacturer)
    );
  }

  // ボディタイプでフィルタ
  if (params.bodyTypes && params.bodyTypes.length > 0) {
    filteredCars = filteredCars.filter((car) =>
      params.bodyTypes!.includes(car.bodyType)
    );
  }

  // 価格範囲でフィルタ
  if (params.priceMin !== undefined) {
    filteredCars = filteredCars.filter((car) => car.price >= params.priceMin!);
  }
  if (params.priceMax !== undefined) {
    filteredCars = filteredCars.filter((car) => car.price <= params.priceMax!);
  }

  // 燃費でフィルタ
  if (params.fuelEfficiencyMin !== undefined) {
    filteredCars = filteredCars.filter(
      (car) =>
        car.fuelEfficiency.wltcMode !== undefined &&
        car.fuelEfficiency.wltcMode >= params.fuelEfficiencyMin!
    );
  }

  // 乗車定員でフィルタ
  if (params.seatingMin !== undefined) {
    filteredCars = filteredCars.filter(
      (car) => car.capacity.seating >= params.seatingMin!
    );
  }

  // 駆動方式でフィルタ
  if (params.driveSystem) {
    filteredCars = filteredCars.filter(
      (car) => car.engine.driveSystem === params.driveSystem
    );
  }

  // エンジンタイプでフィルタ
  if (params.engineTypes && params.engineTypes.length > 0) {
    filteredCars = filteredCars.filter((car) =>
      params.engineTypes!.includes(car.engine.type)
    );
  }

  return filteredCars;
}

export function sortCars(cars: Car[], sortOption: SortOption): Car[] {
  const sorted = [...cars];

  switch (sortOption) {
    case 'price-asc':
      return sorted.sort((a, b) => a.price - b.price);
    case 'price-desc':
      return sorted.sort((a, b) => b.price - a.price);
    case 'fuel-desc':
      return sorted.sort((a, b) => {
        const aFuel = a.fuelEfficiency.wltcMode || 0;
        const bFuel = b.fuelEfficiency.wltcMode || 0;
        return bFuel - aFuel;
      });
    case 'date-desc':
      return sorted.sort((a, b) => b.releaseDate.localeCompare(a.releaseDate));
    case 'date-asc':
      return sorted.sort((a, b) => a.releaseDate.localeCompare(b.releaseDate));
    case 'name-asc':
      return sorted.sort((a, b) => {
        const aName = `${a.manufacturer}${a.model}`;
        const bName = `${b.manufacturer}${b.model}`;
        return aName.localeCompare(bName, 'ja');
      });
    default:
      return sorted;
  }
}

export function getManufacturers(): string[] {
  const manufacturers = new Set(cars.map((car) => car.manufacturer));
  return Array.from(manufacturers).sort((a, b) => a.localeCompare(b, 'ja'));
}

export function getBodyTypes(): string[] {
  const bodyTypes = new Set(cars.map((car) => car.bodyType));
  return Array.from(bodyTypes);
}

export function getPriceRange(): { min: number; max: number } {
  const prices = cars.map((car) => car.price);
  return {
    min: Math.min(...prices),
    max: Math.max(...prices),
  };
}

export function formatPrice(price: number): string {
  return `¥${price.toLocaleString()}`;
}

export function formatFuelEfficiency(wltcMode?: number): string {
  if (wltcMode === undefined) return '-';
  return `${wltcMode} km/L`;
}

export function getSimilarCars(carId: string, limit: number = 4): Car[] {
  const car = getCarById(carId);
  if (!car) return [];

  const similar = cars
    .filter((c) => c.id !== carId)
    .map((c) => {
      let score = 0;

      // 同じボディタイプ
      if (c.bodyType === car.bodyType) score += 3;

      // 価格が近い（±50万円）
      const priceDiff = Math.abs(c.price - car.price);
      if (priceDiff <= 500000) score += 2;
      else if (priceDiff <= 1000000) score += 1;

      // 同じメーカー
      if (c.manufacturer === car.manufacturer) score += 1;

      // 同じエンジンタイプ
      if (c.engine.type === car.engine.type) score += 1;

      return { car: c, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((item) => item.car);

  return similar;
}
