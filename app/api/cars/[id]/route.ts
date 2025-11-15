import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { Car } from '@/types/car';

const CARS_FILE_PATH = path.join(process.cwd(), 'data', 'cars.json');

// PUT - 車両を更新
export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const updatedCar: Car = await request.json();

    const fileContents = fs.readFileSync(CARS_FILE_PATH, 'utf8');
    const cars: Car[] = JSON.parse(fileContents);

    const index = cars.findIndex(car => car.id === id);
    if (index === -1) {
      return NextResponse.json({ error: 'Car not found' }, { status: 404 });
    }

    cars[index] = updatedCar;
    fs.writeFileSync(CARS_FILE_PATH, JSON.stringify(cars, null, 2));

    return NextResponse.json({ success: true, car: updatedCar });
  } catch (error) {
    console.error('Error updating car:', error);
    return NextResponse.json({ error: 'Failed to update car' }, { status: 500 });
  }
}

// DELETE - 車両を削除
export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;

    const fileContents = fs.readFileSync(CARS_FILE_PATH, 'utf8');
    const cars: Car[] = JSON.parse(fileContents);

    const filteredCars = cars.filter(car => car.id !== id);

    if (filteredCars.length === cars.length) {
      return NextResponse.json({ error: 'Car not found' }, { status: 404 });
    }

    fs.writeFileSync(CARS_FILE_PATH, JSON.stringify(filteredCars, null, 2));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting car:', error);
    return NextResponse.json({ error: 'Failed to delete car' }, { status: 500 });
  }
}
