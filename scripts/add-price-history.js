const fs = require('fs');
const path = require('path');

// 価格推移データを追加するスクリプト
const carsPath = path.join(__dirname, '../data/cars.json');
const cars = JSON.parse(fs.readFileSync(carsPath, 'utf8'));

// 特定の車種に価格推移データを追加
const priceHistoryData = {
  'toyota-prius-2023-e': [
    { date: '2023-01', price: 2750000 },
    { date: '2023-06', price: 2800000 },
    { date: '2024-01', price: 2850000 },
    { date: '2024-06', price: 2900000 },
  ],
  'nissan-gt-r-2023-pure': [
    { date: '2020-01', price: 12500000 },
    { date: '2021-01', price: 12800000 },
    { date: '2022-01', price: 13100000 },
    { date: '2023-01', price: 13389800 },
  ],
  'toyota-alphard-2023-x': [
    { date: '2023-06', price: 5400000 },
    { date: '2023-09', price: 5450000 },
    { date: '2024-01', price: 5500000 },
    { date: '2024-06', price: 5550000 },
  ],
  'honda-nsx-2023-base': [
    { date: '2019-01', price: 23500000 },
    { date: '2020-01', price: 23800000 },
    { date: '2021-01', price: 24000000 },
    { date: '2022-01', price: 24200000 },
  ],
  'toyota-harrier-2023-s': [
    { date: '2020-06', price: 2990000 },
    { date: '2021-01', price: 3050000 },
    { date: '2022-01', price: 3100000 },
    { date: '2023-01', price: 3128000 },
  ],
  'mazda-cx-5-2023-xd': [
    { date: '2021-01', price: 2980000 },
    { date: '2022-01', price: 3050000 },
    { date: '2023-01', price: 3158500 },
    { date: '2024-01', price: 3200000 },
  ],
  'nissan-leaf-2023-g': [
    { date: '2020-01', price: 4150000 },
    { date: '2021-01', price: 4250000 },
    { date: '2022-01', price: 4350000 },
    { date: '2023-01', price: 4488800 },
  ],
  'subaru-levorg-2023-gt-h': [
    { date: '2020-10', price: 3608000 },
    { date: '2021-06', price: 3700000 },
    { date: '2022-06', price: 3800000 },
    { date: '2023-01', price: 3872000 },
  ],
  'toyota-crown-2023-crossover': [
    { date: '2022-09', price: 6350000 },
    { date: '2023-03', price: 6400000 },
    { date: '2023-09', price: 6450000 },
    { date: '2024-03', price: 6500000 },
  ],
  'lexus-rx-2023-base': [
    { date: '2022-11', price: 6400000 },
    { date: '2023-04', price: 6450000 },
    { date: '2023-10', price: 6500000 },
    { date: '2024-04', price: 6550000 },
  ],
};

// 各車両に価格推移を追加
let updated = 0;
cars.forEach((car) => {
  if (priceHistoryData[car.id]) {
    car.priceHistory = priceHistoryData[car.id];
    updated++;
  }
});

// ファイルに保存
fs.writeFileSync(carsPath, JSON.stringify(cars, null, 2));
console.log(`Added price history to ${updated} cars.`);
