const fs = require('fs');
const path = require('path');

// テンプレートベースで車種を大量生成
const manufacturers = {
  "トヨタ": ["カローラ", "カムリ", "C-HR", "ノア", "エスクァイア", "86", "GRヤリス", "GR86", "bZ4X", "ルーミー"],
  "日産": ["スカイライン", "フェアレディZ", "エクストレイル", "キックス", "ノート オーラ", "オーラ", "デイズ", "ルークス", "サクラ", "アリア"],
  "ホンダ": ["シビック", "アコード", "CR-V", "ZR-V", "フリード", "N-BOX", "N-WGN", "N-ONE", "S660"],
  "マツダ": ["CX-30", "CX-8", "CX-90", "MAZDA2", "MAZDA6", "ロードスター", "ロードスターRF"],
  "スバル": ["WRX S4", "BRZ", "クロストレック", "ソルテラ"],
  "スズキ": ["ジムニー", "ジムニーシエラ", "クロスビー", "ソリオ", "イグニス", "スイフト", "スイフトスポーツ", "エブリイワゴン", "ワゴンR", "ラパン"],
  "ダイハツ": ["ロッキー", "タフト", "コペン", "ミラトコット", "ムーヴ", "ブーン"],
  "三菱": ["エクリプスクロス", "RVR", "ミラージュ", "eKワゴン", "eKスペース", "タウンボックス"]
};

const bodyTypes = {
  "カローラ": "セダン", "カムリ": "セダン", "C-HR": "SUV", "ノア": "ミニバン", "エスクァイア": "ミニバン",
  "86": "スポーツカー", "GRヤリス": "ハッチバック", "GR86": "スポーツカー", "bZ4X": "SUV", "ルーミー": "コンパクトカー",
  "スカイライン": "セダン", "フェアレディZ": "スポーツカー", "エクストレイル": "SUV", "キックス": "SUV",
  "ノート オーラ": "コンパクトカー", "オーラ": "コンパクトカー", "デイズ": "軽自動車", "ルークス": "軽自動車", "サクラ": "軽自動車", "アリア": "SUV",
  "シビック": "セダン", "アコード": "セダン", "CR-V": "SUV", "ZR-V": "SUV", "フリード": "ミニバン",
  "N-BOX": "軽自動車", "N-WGN": "軽自動車", "N-ONE": "軽自動車", "S660": "スポーツカー",
  "CX-30": "SUV", "CX-8": "SUV", "CX-90": "SUV", "MAZDA2": "コンパクトカー", "MAZDA6": "セダン",
  "ロードスター": "スポーツカー", "ロードスターRF": "スポーツカー",
  "WRX S4": "セダン", "BRZ": "スポーツカー", "クロストレック": "SUV", "ソルテラ": "SUV",
  "ジムニー": "軽自動車", "ジムニーシエラ": "SUV", "クロスビー": "SUV", "ソリオ": "コンパクトカー",
  "イグニス": "コンパクトカー", "スイフト": "コンパクトカー", "スイフトスポーツ": "ハッチバック",
  "エブリイワゴン": "軽自動車", "ワゴンR": "軽自動車", "ラパン": "軽自動車",
  "ロッキー": "SUV", "タフト": "軽自動車", "コペン": "軽自動車", "ミラトコット": "軽自動車",
  "ムーヴ": "軽自動車", "ブーン": "コンパクトカー",
  "エクリプスクロス": "SUV", "RVR": "SUV", "ミラージュ": "コンパクトカー",
  "eKワゴン": "軽自動車", "eKスペース": "軽自動車", "タウンボックス": "軽自動車"
};

const cars = [];

Object.entries(manufacturers).forEach(([manufacturer, models]) => {
  models.forEach((model, index) => {
    const bodyType = bodyTypes[model] || "セダン";
    const isEV = model.includes("bZ") || model.includes("サクラ") || model.includes("ソルテラ") || model.includes("アリア");
    const isKei = bodyType === "軽自動車";
    const isSports = bodyType === "スポーツカー";

    const basePrice = isKei ? 1500000 : isSports ? 3000000 : bodyType === "ミニバン" ? 3500000 : 2500000;
    const price = basePrice + (index * 100000);

    const manufacturerEn = manufacturer === "トヨタ" ? "toyota" : manufacturer === "日産" ? "nissan" : manufacturer === "ホンダ" ? "honda" : manufacturer === "マツダ" ? "mazda" : manufacturer === "スバル" ? "subaru" : manufacturer === "スズキ" ? "suzuki" : manufacturer === "ダイハツ" ? "daihatsu" : "mitsubishi";
    const modelId = model.replace(/\s+/g, '-').replace(/:/g, '').toLowerCase();

    const car = {
      "id": manufacturerEn + "-" + modelId + "-2023-" + index,
      "manufacturer": manufacturer,
      "model": model,
      "grade": "X",
      "bodyType": bodyType,
      "price": price,
      "releaseDate": "2023-01",
      "dimensions": {
        "length": isKei ? 3395 : 4500,
        "width": isKei ? 1475 : 1800,
        "height": bodyType === "ミニバン" ? 1850 : isKei ? 1650 : 1500,
        "wheelbase": isKei ? 2460 : 2650,
        "weight": isKei ? 900 : 1500,
        "minTurningRadius": isKei ? 4.5 : 5.3,
        "groundClearance": bodyType === "SUV" ? 180 : 140
      },
      "capacity": {"seating": bodyType === "ミニバン" ? 7 : bodyType === "SUV" ? 5 : isKei ? 4 : 5},
      "engine": {
        "type": isEV ? "EV" : "ハイブリッド",
        "displacement": isEV ? undefined : isKei ? 660 : 2000,
        "maxPower": isEV ? "150kW(204PS)" : isKei ? "38kW(52PS)" : "110kW(150PS)",
        "maxTorque": isEV ? "300N・m" : isKei ? "60N・m" : "200N・m",
        "transmission": isEV ? "AT" : "CVT",
        "driveSystem": bodyType === "SUV" ? "4WD" : "FF"
      },
      "fuelEfficiency": {
        "wltcMode": isEV ? undefined : isKei ? 24.0 : 20.0,
        "cityMode": isEV ? undefined : isKei ? 23.0 : 18.0,
        "suburbanMode": isEV ? undefined : isKei ? 25.0 : 21.0,
        "highwayMode": isEV ? undefined : isKei ? 23.5 : 20.5,
        "cruisingRange": isEV ? 400 : undefined,
        "ecoCarTax": true
      },
      "safety": {
        "collisionMitigationBrake": true,
        "falseStartSuppression": true,
        "laneDepartureWarning": true,
        "laneKeepingAssist": true,
        "adaptiveCruiseControl": true,
        "blindSpotMonitor": !isKei,
        "camera360": bodyType === "ミニバン",
        "parkingAssist": true,
        "airbags": isKei ? 6 : 7
      },
      "comfort": {
        "navigation": price > 3000000,
        "etc": price > 2500000,
        "backCamera": true,
        "powerSeat": price > 3500000,
        "seatHeater": price > 3000000,
        "steeringHeater": false,
        "autoAircon": true,
        "ledHeadlight": true,
        "smartKey": true,
        "powerBackDoor": bodyType === "ミニバン",
        "handsFreeBackDoor": false,
        "sunroof": price > 4000000
      },
      "images": {
        "exterior": ["/images/placeholder-car.jpg"],
        "interior": ["/images/placeholder-interior.jpg"]
      },
      "officialUrl": "https://" + (manufacturer === "トヨタ" ? "toyota.jp" : manufacturer === "日産" ? "nissan.co.jp" : manufacturer === "ホンダ" ? "honda.co.jp" : manufacturer === "マツダ" ? "mazda.co.jp" : manufacturer === "スバル" ? "subaru.jp" : manufacturer === "スズキ" ? "suzuki.co.jp" : manufacturer === "ダイハツ" ? "daihatsu.co.jp" : "mitsubishi-motors.co.jp") + "/",
      "description": manufacturer + "の" + model + "。" + bodyType + "タイプで、日常使いに最適な一台です。"
    };

    cars.push(car);
  });
});

// 既存データに追加
const carsPath = path.join(__dirname, '../data/cars.json');
const existingCars = JSON.parse(fs.readFileSync(carsPath, 'utf8'));
const allCars = [...existingCars, ...cars];

fs.writeFileSync(carsPath, JSON.stringify(allCars, null, 2));
console.log('Added ' + cars.length + ' cars. Total: ' + allCars.length + ' cars');
