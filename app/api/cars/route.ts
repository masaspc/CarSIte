import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { Car } from '@/types/car';

const CARS_FILE_PATH = path.join(process.cwd(), 'data', 'cars.json');

// GET - すべての車両を取得
export async function GET() {
  try {
    const fileContents = fs.readFileSync(CARS_FILE_PATH, 'utf8');
    const cars: Car[] = JSON.parse(fileContents);
    return NextResponse.json(cars);
  } catch (error) {
    console.error('Error reading cars file:', error);
    return NextResponse.json({ error: 'Failed to read cars' }, { status: 500 });
  }
}

// POST - 新しい車両を追加
export async function POST(request: NextRequest) {
  try {
    const newCar: Car = await request.json();

    const fileContents = fs.readFileSync(CARS_FILE_PATH, 'utf8');
    const cars: Car[] = JSON.parse(fileContents);

    // IDの重複チェック
    if (cars.some(car => car.id === newCar.id)) {
      return NextResponse.json({ error: 'Car ID already exists' }, { status: 400 });
    }

    cars.push(newCar);
    fs.writeFileSync(CARS_FILE_PATH, JSON.stringify(cars, null, 2));

    return NextResponse.json({ success: true, car: newCar });
  } catch (error) {
    console.error('Error adding car:', error);
    return NextResponse.json({ error: 'Failed to add car' }, { status: 500 });
  }
}
