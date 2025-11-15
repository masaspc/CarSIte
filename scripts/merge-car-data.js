const fs = require('fs');
const path = require('path');

// 既存のデータを読み込み
const carsPath = path.join(__dirname, '../data/cars.json');
const additionalPath = path.join(__dirname, '../data/additional-cars.json');

const existingCars = JSON.parse(fs.readFileSync(carsPath, 'utf8'));
const additionalCars = JSON.parse(fs.readFileSync(additionalPath, 'utf8'));

// マージ
const allCars = [...existingCars, ...additionalCars];

// 保存
fs.writeFileSync(carsPath, JSON.stringify(allCars, null, 2));

console.log(`Merged ${existingCars.length} + ${additionalCars.length} = ${allCars.length} cars`);
