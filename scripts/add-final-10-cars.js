const fs = require('fs');
const path = require('path');

// 最後の10車種を追加（合計105車種に）
const finalTenCars = [
  {
    "id": "lexus-ls-2023-base",
    "manufacturer": "レクサス",
    "model": "LS",
    "grade": "標準",
    "bodyType": "セダン",
    "price": 12600000,
    "releaseDate": "2023-01",
    "dimensions": {
      "length": 5235,
      "width": 1900,
      "height": 1450,
      "wheelbase": 3125,
      "weight": 2150,
      "minTurningRadius": 5.6,
      "groundClearance": 135
    },
    "capacity": {"seating": 5},
    "engine": {
      "type": "ハイブリッド",
      "displacement": 3456,
      "maxPower": "220kW(299PS)",
      "maxTorque": "356N・m",
      "transmission": "電気式無段変速機",
      "driveSystem": "4WD"
    },
    "fuelEfficiency": {
      "wltcMode": 12.6,
      "cityMode": 10.8,
      "suburbanMode": 13.2,
      "highwayMode": 13.5,
      "ecoCarTax": false
    },
    "safety": {
      "collisionMitigationBrake": true,
      "falseStartSuppression": true,
      "laneDepartureWarning": true,
      "laneKeepingAssist": true,
      "adaptiveCruiseControl": true,
      "blindSpotMonitor": true,
      "camera360": true,
      "parkingAssist": true,
      "airbags": 12
    },
    "comfort": {
      "navigation": true,
      "etc": true,
      "backCamera": true,
      "powerSeat": true,
      "seatHeater": true,
      "steeringHeater": true,
      "autoAircon": true,
      "ledHeadlight": true,
      "smartKey": true,
      "powerBackDoor": false,
      "handsFreeBackDoor": false,
      "sunroof": true
    },
    "images": {
      "exterior": ["/images/placeholder-car.jpg"],
      "interior": ["/images/placeholder-interior.jpg"]
    },
    "officialUrl": "https://lexus.jp/models/ls/",
    "description": "レクサスのフラッグシップセダン。最高級の快適性と先進技術を提供。"
  },
  {
    "id": "lexus-rx-2023-base",
    "manufacturer": "レクサス",
    "model": "RX",
    "grade": "標準",
    "bodyType": "SUV",
    "price": 6400000,
    "releaseDate": "2022-11",
    "dimensions": {
      "length": 4890,
      "width": 1920,
      "height": 1700,
      "wheelbase": 2850,
      "weight": 1980,
      "minTurningRadius": 5.9,
      "groundClearance": 200
    },
    "capacity": {"seating": 5},
    "engine": {
      "type": "ハイブリッド",
      "displacement": 2487,
      "maxPower": "140kW(190PS)",
      "maxTorque": "236N・m",
      "transmission": "電気式無段変速機",
      "driveSystem": "4WD"
    },
    "fuelEfficiency": {
      "wltcMode": 15.8,
      "cityMode": 14.2,
      "suburbanMode": 16.5,
      "highwayMode": 16.3,
      "ecoCarTax": true
    },
    "safety": {
      "collisionMitigationBrake": true,
      "falseStartSuppression": true,
      "laneDepartureWarning": true,
      "laneKeepingAssist": true,
      "adaptiveCruiseControl": true,
      "blindSpotMonitor": true,
      "camera360": true,
      "parkingAssist": true,
      "airbags": 10
    },
    "comfort": {
      "navigation": true,
      "etc": true,
      "backCamera": true,
      "powerSeat": true,
      "seatHeater": true,
      "steeringHeater": true,
      "autoAircon": true,
      "ledHeadlight": true,
      "smartKey": true,
      "powerBackDoor": true,
      "handsFreeBackDoor": true,
      "sunroof": true
    },
    "images": {
      "exterior": ["/images/placeholder-car.jpg"],
      "interior": ["/images/placeholder-interior.jpg"]
    },
    "officialUrl": "https://lexus.jp/models/rx/",
    "description": "レクサスの人気SUV。上質な乗り心地と先進的なデザインが魅力。"
  },
  {
    "id": "honda-e-2023-base",
    "manufacturer": "ホンダ",
    "model": "Honda e",
    "grade": "標準",
    "bodyType": "ハッチバック",
    "price": 4950000,
    "releaseDate": "2020-08",
    "dimensions": {
      "length": 3895,
      "width": 1752,
      "height": 1512,
      "wheelbase": 2530,
      "weight": 1540,
      "minTurningRadius": 4.3,
      "groundClearance": 145
    },
    "capacity": {"seating": 4},
    "engine": {
      "type": "EV",
      "maxPower": "113kW(154PS)",
      "maxTorque": "315N・m",
      "transmission": "AT",
      "driveSystem": "FF"
    },
    "fuelEfficiency": {
      "cruisingRange": 283,
      "ecoCarTax": true
    },
    "safety": {
      "collisionMitigationBrake": true,
      "falseStartSuppression": true,
      "laneDepartureWarning": true,
      "laneKeepingAssist": true,
      "adaptiveCruiseControl": true,
      "blindSpotMonitor": false,
      "camera360": false,
      "parkingAssist": true,
      "airbags": 6
    },
    "comfort": {
      "navigation": true,
      "etc": true,
      "backCamera": true,
      "powerSeat": false,
      "seatHeater": true,
      "steeringHeater": false,
      "autoAircon": true,
      "ledHeadlight": true,
      "smartKey": true,
      "powerBackDoor": false,
      "handsFreeBackDoor": false,
      "sunroof": false
    },
    "images": {
      "exterior": ["/images/placeholder-car.jpg"],
      "interior": ["/images/placeholder-interior.jpg"]
    },
    "officialUrl": "https://www.honda.co.jp/honda-e/",
    "description": "ホンダの都市型EV。レトロモダンなデザインと先進技術の融合。"
  },
  {
    "id": "nissan-leaf-2023-g",
    "manufacturer": "日産",
    "model": "リーフ",
    "grade": "G",
    "bodyType": "ハッチバック",
    "price": 4488800,
    "releaseDate": "2023-01",
    "dimensions": {
      "length": 4480,
      "width": 1790,
      "height": 1540,
      "wheelbase": 2700,
      "weight": 1670,
      "minTurningRadius": 5.2,
      "groundClearance": 150
    },
    "capacity": {"seating": 5},
    "engine": {
      "type": "EV",
      "maxPower": "110kW(150PS)",
      "maxTorque": "320N・m",
      "transmission": "AT",
      "driveSystem": "FF"
    },
    "fuelEfficiency": {
      "cruisingRange": 450,
      "ecoCarTax": true
    },
    "safety": {
      "collisionMitigationBrake": true,
      "falseStartSuppression": true,
      "laneDepartureWarning": true,
      "laneKeepingAssist": true,
      "adaptiveCruiseControl": true,
      "blindSpotMonitor": true,
      "camera360": true,
      "parkingAssist": true,
      "airbags": 7
    },
    "comfort": {
      "navigation": true,
      "etc": true,
      "backCamera": true,
      "powerSeat": false,
      "seatHeater": true,
      "steeringHeater": true,
      "autoAircon": true,
      "ledHeadlight": true,
      "smartKey": true,
      "powerBackDoor": false,
      "handsFreeBackDoor": false,
      "sunroof": false
    },
    "images": {
      "exterior": ["/images/placeholder-car.jpg"],
      "interior": ["/images/placeholder-interior.jpg"]
    },
    "officialUrl": "https://www3.nissan.co.jp/vehicles/new/leaf.html",
    "description": "日本を代表するEV。進化を続ける電気自動車のパイオニア。"
  },
  {
    "id": "toyota-alphard-2023-x",
    "manufacturer": "トヨタ",
    "model": "アルファード",
    "grade": "X",
    "bodyType": "ミニバン",
    "price": 5400000,
    "releaseDate": "2023-06",
    "dimensions": {
      "length": 4995,
      "width": 1850,
      "height": 1935,
      "wheelbase": 3000,
      "weight": 2110,
      "minTurningRadius": 5.9,
      "groundClearance": 165
    },
    "capacity": {"seating": 7},
    "engine": {
      "type": "ハイブリッド",
      "displacement": 2487,
      "maxPower": "140kW(190PS)",
      "maxTorque": "236N・m",
      "transmission": "電気式無段変速機",
      "driveSystem": "4WD"
    },
    "fuelEfficiency": {
      "wltcMode": 17.5,
      "cityMode": 16.8,
      "suburbanMode": 18.5,
      "highwayMode": 17.3,
      "ecoCarTax": true
    },
    "safety": {
      "collisionMitigationBrake": true,
      "falseStartSuppression": true,
      "laneDepartureWarning": true,
      "laneKeepingAssist": true,
      "adaptiveCruiseControl": true,
      "blindSpotMonitor": true,
      "camera360": true,
      "parkingAssist": true,
      "airbags": 8
    },
    "comfort": {
      "navigation": true,
      "etc": true,
      "backCamera": true,
      "powerSeat": true,
      "seatHeater": true,
      "steeringHeater": true,
      "autoAircon": true,
      "ledHeadlight": true,
      "smartKey": true,
      "powerBackDoor": true,
      "handsFreeBackDoor": true,
      "sunroof": true
    },
    "images": {
      "exterior": ["/images/placeholder-car.jpg"],
      "interior": ["/images/placeholder-interior.jpg"]
    },
    "officialUrl": "https://toyota.jp/alphard/",
    "description": "トヨタの最高級ミニバン。圧倒的な存在感と上質な室内空間。"
  },
  {
    "id": "mazda-cx-5-2023-xd",
    "manufacturer": "マツダ",
    "model": "CX-5",
    "grade": "XD",
    "bodyType": "SUV",
    "price": 3158500,
    "releaseDate": "2023-01",
    "dimensions": {
      "length": 4575,
      "width": 1845,
      "height": 1690,
      "wheelbase": 2700,
      "weight": 1680,
      "minTurningRadius": 5.5,
      "groundClearance": 210
    },
    "capacity": {"seating": 5},
    "engine": {
      "type": "ディーゼル",
      "displacement": 2188,
      "maxPower": "147kW(200PS)",
      "maxTorque": "450N・m",
      "transmission": "6AT",
      "driveSystem": "4WD"
    },
    "fuelEfficiency": {
      "wltcMode": 16.6,
      "cityMode": 13.3,
      "suburbanMode": 16.8,
      "highwayMode": 18.9,
      "ecoCarTax": true
    },
    "safety": {
      "collisionMitigationBrake": true,
      "falseStartSuppression": true,
      "laneDepartureWarning": true,
      "laneKeepingAssist": true,
      "adaptiveCruiseControl": true,
      "blindSpotMonitor": true,
      "camera360": true,
      "parkingAssist": true,
      "airbags": 6
    },
    "comfort": {
      "navigation": false,
      "etc": false,
      "backCamera": true,
      "powerSeat": true,
      "seatHeater": true,
      "steeringHeater": false,
      "autoAircon": true,
      "ledHeadlight": true,
      "smartKey": true,
      "powerBackDoor": true,
      "handsFreeBackDoor": false,
      "sunroof": false
    },
    "images": {
      "exterior": ["/images/placeholder-car.jpg"],
      "interior": ["/images/placeholder-interior.jpg"]
    },
    "officialUrl": "https://www.mazda.co.jp/cars/cx-5/",
    "description": "マツダの人気SUV。洗練されたデザインと走る歓びを提供。"
  },
  {
    "id": "subaru-levorg-2023-gt-h",
    "manufacturer": "スバル",
    "model": "レヴォーグ",
    "grade": "GT-H",
    "bodyType": "ステーションワゴン",
    "price": 3872000,
    "releaseDate": "2023-01",
    "dimensions": {
      "length": 4755,
      "width": 1795,
      "height": 1500,
      "wheelbase": 2670,
      "weight": 1580,
      "minTurningRadius": 5.5,
      "groundClearance": 145
    },
    "capacity": {"seating": 5},
    "engine": {
      "type": "ガソリン",
      "displacement": 1795,
      "maxPower": "130kW(177PS)",
      "maxTorque": "300N・m",
      "transmission": "CVT",
      "driveSystem": "4WD"
    },
    "fuelEfficiency": {
      "wltcMode": 13.6,
      "cityMode": 10.2,
      "suburbanMode": 13.9,
      "highwayMode": 15.9,
      "ecoCarTax": false
    },
    "safety": {
      "collisionMitigationBrake": true,
      "falseStartSuppression": true,
      "laneDepartureWarning": true,
      "laneKeepingAssist": true,
      "adaptiveCruiseControl": true,
      "blindSpotMonitor": true,
      "camera360": false,
      "parkingAssist": true,
      "airbags": 7
    },
    "comfort": {
      "navigation": true,
      "etc": true,
      "backCamera": true,
      "powerSeat": true,
      "seatHeater": true,
      "steeringHeater": false,
      "autoAircon": true,
      "ledHeadlight": true,
      "smartKey": true,
      "powerBackDoor": true,
      "handsFreeBackDoor": false,
      "sunroof": false
    },
    "images": {
      "exterior": ["/images/placeholder-car.jpg"],
      "interior": ["/images/placeholder-interior.jpg"]
    },
    "officialUrl": "https://www.subaru.jp/levorg/",
    "description": "スバルのスポーツワゴン。実用性と走行性能を高次元で融合。"
  },
  {
    "id": "toyota-crown-2023-crossover",
    "manufacturer": "トヨタ",
    "model": "クラウン クロスオーバー",
    "grade": "G",
    "bodyType": "SUV",
    "price": 6350000,
    "releaseDate": "2022-09",
    "dimensions": {
      "length": 4930,
      "width": 1840,
      "height": 1540,
      "wheelbase": 2850,
      "weight": 1820,
      "minTurningRadius": 5.7,
      "groundClearance": 170
    },
    "capacity": {"seating": 5},
    "engine": {
      "type": "ハイブリッド",
      "displacement": 2487,
      "maxPower": "140kW(190PS)",
      "maxTorque": "236N・m",
      "transmission": "電気式無段変速機",
      "driveSystem": "4WD"
    },
    "fuelEfficiency": {
      "wltcMode": 15.7,
      "cityMode": 14.3,
      "suburbanMode": 16.5,
      "highwayMode": 16.1,
      "ecoCarTax": true
    },
    "safety": {
      "collisionMitigationBrake": true,
      "falseStartSuppression": true,
      "laneDepartureWarning": true,
      "laneKeepingAssist": true,
      "adaptiveCruiseControl": true,
      "blindSpotMonitor": true,
      "camera360": true,
      "parkingAssist": true,
      "airbags": 9
    },
    "comfort": {
      "navigation": true,
      "etc": true,
      "backCamera": true,
      "powerSeat": true,
      "seatHeater": true,
      "steeringHeater": true,
      "autoAircon": true,
      "ledHeadlight": true,
      "smartKey": true,
      "powerBackDoor": true,
      "handsFreeBackDoor": true,
      "sunroof": true
    },
    "images": {
      "exterior": ["/images/placeholder-car.jpg"],
      "interior": ["/images/placeholder-interior.jpg"]
    },
    "officialUrl": "https://toyota.jp/crown/crossover/",
    "description": "クラウンの新時代。SUVスタイルとセダンの上質さを融合。"
  },
  {
    "id": "honda-stepwgn-2023-air",
    "manufacturer": "ホンダ",
    "model": "ステップワゴン",
    "grade": "AIR",
    "bodyType": "ミニバン",
    "price": 3257000,
    "releaseDate": "2022-05",
    "dimensions": {
      "length": 4800,
      "width": 1750,
      "height": 1840,
      "wheelbase": 2890,
      "weight": 1760,
      "minTurningRadius": 5.7,
      "groundClearance": 150
    },
    "capacity": {"seating": 7},
    "engine": {
      "type": "ハイブリッド",
      "displacement": 1993,
      "maxPower": "107kW(145PS)",
      "maxTorque": "175N・m",
      "transmission": "電気式無段変速機",
      "driveSystem": "FF"
    },
    "fuelEfficiency": {
      "wltcMode": 20.0,
      "cityMode": 19.5,
      "suburbanMode": 21.3,
      "highwayMode": 19.6,
      "ecoCarTax": true
    },
    "safety": {
      "collisionMitigationBrake": true,
      "falseStartSuppression": true,
      "laneDepartureWarning": true,
      "laneKeepingAssist": true,
      "adaptiveCruiseControl": true,
      "blindSpotMonitor": true,
      "camera360": true,
      "parkingAssist": true,
      "airbags": 7
    },
    "comfort": {
      "navigation": false,
      "etc": false,
      "backCamera": true,
      "powerSeat": false,
      "seatHeater": false,
      "steeringHeater": false,
      "autoAircon": true,
      "ledHeadlight": true,
      "smartKey": true,
      "powerBackDoor": true,
      "handsFreeBackDoor": false,
      "sunroof": false
    },
    "images": {
      "exterior": ["/images/placeholder-car.jpg"],
      "interior": ["/images/placeholder-interior.jpg"]
    },
    "officialUrl": "https://www.honda.co.jp/STEPWGN/",
    "description": "ホンダの使いやすいミニバン。家族のニーズに応える実用性。"
  },
  {
    "id": "toyota-landcruiser-2023-zx",
    "manufacturer": "トヨタ",
    "model": "ランドクルーザー",
    "grade": "ZX",
    "bodyType": "SUV",
    "price": 7300000,
    "releaseDate": "2021-08",
    "dimensions": {
      "length": 4985,
      "width": 1980,
      "height": 1925,
      "wheelbase": 2850,
      "weight": 2430,
      "minTurningRadius": 5.9,
      "groundClearance": 225
    },
    "capacity": {"seating": 7},
    "engine": {
      "type": "ディーゼル",
      "displacement": 3346,
      "maxPower": "227kW(309PS)",
      "maxTorque": "700N・m",
      "transmission": "10AT",
      "driveSystem": "4WD"
    },
    "fuelEfficiency": {
      "wltcMode": 9.7,
      "cityMode": 8.0,
      "suburbanMode": 9.7,
      "highwayMode": 11.1,
      "ecoCarTax": false
    },
    "safety": {
      "collisionMitigationBrake": true,
      "falseStartSuppression": true,
      "laneDepartureWarning": true,
      "laneKeepingAssist": true,
      "adaptiveCruiseControl": true,
      "blindSpotMonitor": true,
      "camera360": true,
      "parkingAssist": true,
      "airbags": 10
    },
    "comfort": {
      "navigation": true,
      "etc": true,
      "backCamera": true,
      "powerSeat": true,
      "seatHeater": true,
      "steeringHeater": true,
      "autoAircon": true,
      "ledHeadlight": true,
      "smartKey": true,
      "powerBackDoor": true,
      "handsFreeBackDoor": true,
      "sunroof": true
    },
    "images": {
      "exterior": ["/images/placeholder-car.jpg"],
      "interior": ["/images/placeholder-interior.jpg"]
    },
    "officialUrl": "https://toyota.jp/landcruiser/",
    "description": "世界中で信頼される本格SUV。どんな道でも走破する力強さ。"
  }
];

// 既存データに追加
const carsPath = path.join(__dirname, '../data/cars.json');
const existingCars = JSON.parse(fs.readFileSync(carsPath, 'utf8'));
const allCars = [...existingCars, ...finalTenCars];

fs.writeFileSync(carsPath, JSON.stringify(allCars, null, 2));
console.log('Added ' + finalTenCars.length + ' final cars. Total: ' + allCars.length + ' cars');
