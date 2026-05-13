import { v4 as uuid } from 'uuid';
import type { Food, Vec2 } from '../types';
import {
  ARENA_WIDTH, ARENA_HEIGHT, FOOD_COUNT, FOOD_VALUE,
  FOOD_SPAWN_WEIGHT, CELL_SIZE,
} from './constants';

type FoodType = Food['type'];

export class FoodManager {
  private foods: Map<string, Food> = new Map();

  constructor() {
    this.spawnInitialFood();
  }

  private spawnInitialFood() {
    for (let i = 0; i < FOOD_COUNT; i++) {
      this.spawnOne(this._randomPos());
    }
  }

  spawnOne(pos: Vec2): Food {
    const type = this._weightedType();
    const food: Food = {
      id:        uuid(),
      x:         pos.x,
      y:         pos.y,
      type,
      value:     FOOD_VALUE[type] ?? 1,
      spawnedAt: Date.now(),
    };
    this.foods.set(food.id, food);
    return food;
  }

  consume(foodId: string): Food | null {
    const food = this.foods.get(foodId);
    if (!food) return null;
    this.foods.delete(foodId);
    return food;
  }

  // Replenish food to maintain target count, return newly spawned items
  replenish(): Food[] {
    const deficit = FOOD_COUNT - this.foods.size;
    if (deficit <= 0) return [];
    const spawned: Food[] = [];
    const batch = Math.min(deficit, 10); // max 10 spawns per tick
    for (let i = 0; i < batch; i++) {
      spawned.push(this.spawnOne(this._randomPos()));
    }
    return spawned;
  }

  // Check if any snake head is within pickup radius of food
  checkPickups(headPos: Vec2, radius: number): Food | null {
    for (const food of this.foods.values()) {
      const dx = food.x - headPos.x;
      const dy = food.y - headPos.y;
      if (dx * dx + dy * dy <= radius * radius) {
        return food;
      }
    }
    return null;
  }

  getAll(): Food[] { return Array.from(this.foods.values()); }
  getMap(): Map<string, Food> { return this.foods; }
  count(): number { return this.foods.size; }

  serialize(): Record<string, Food> {
    const out: Record<string, Food> = {};
    this.foods.forEach((f, id) => { out[id] = f; });
    return out;
  }

  private _randomPos(): Vec2 {
    const margin = CELL_SIZE * 3;
    return {
      x: margin + Math.random() * (ARENA_WIDTH  - margin * 2),
      y: margin + Math.random() * (ARENA_HEIGHT - margin * 2),
    };
  }

  private _weightedType(): FoodType {
    const total = Object.values(FOOD_SPAWN_WEIGHT).reduce((a, b) => a + b, 0);
    let rng = Math.random() * total;
    for (const [type, weight] of Object.entries(FOOD_SPAWN_WEIGHT)) {
      rng -= weight;
      if (rng <= 0) return type as FoodType;
    }
    return 'NORMAL';
  }
}
