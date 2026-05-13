import type { Snake, Vec2 } from '../types';
import { HEAD_COLLISION_RADIUS, ARENA_WIDTH, ARENA_HEIGHT } from './constants';

export interface CollisionResult {
  type: 'WALL' | 'SELF' | 'SNAKE' | 'NONE';
  killedBy?: string; // playerId of killer snake
}

export class CollisionDetector {
  // Check wall + snake-body collisions for a single snake head
  static check(snake: Snake, allSnakes: Map<string, Snake>): CollisionResult {
    const head = snake.segments[0];
    if (!head) return { type: 'NONE' };

    // Wall collision
    if (head.x <= 0 || head.x >= ARENA_WIDTH || head.y <= 0 || head.y >= ARENA_HEIGHT) {
      return { type: 'WALL' };
    }

    // Self collision (skip first 4 segments to avoid false positives near head)
    for (let i = 4; i < snake.segments.length; i++) {
      if (CollisionDetector._dist2(head, snake.segments[i]!) < HEAD_COLLISION_RADIUS ** 2) {
        return { type: 'SELF' };
      }
    }

    // Other snake collisions
    for (const [otherId, other] of allSnakes) {
      if (otherId === snake.playerId || !other.alive) continue;

      // Head-to-head: both die, smaller snake loses (tie = both die)
      const otherHead = other.segments[0]!;
      if (CollisionDetector._dist2(head, otherHead) < (HEAD_COLLISION_RADIUS * 2) ** 2) {
        if (snake.length <= other.length) {
          return { type: 'SNAKE', killedBy: other.playerId };
        }
        // This snake wins head-to-head — other snake handled when its turn runs
        continue;
      }

      // Head-into-body collision
      for (let i = 1; i < other.segments.length; i++) {
        if (CollisionDetector._dist2(head, other.segments[i]!) < HEAD_COLLISION_RADIUS ** 2) {
          return { type: 'SNAKE', killedBy: other.playerId };
        }
      }
    }

    return { type: 'NONE' };
  }

  // Spatial grid for O(1) broad-phase (used when playerCount > 20)
  static buildGrid(
    snakes: Map<string, Snake>,
    cellSize: number,
  ): Map<string, Vec2[]> {
    const grid = new Map<string, Vec2[]>();
    for (const snake of snakes.values()) {
      if (!snake.alive) continue;
      for (const seg of snake.segments) {
        const key = `${Math.floor(seg.x / cellSize)},${Math.floor(seg.y / cellSize)}`;
        const cell = grid.get(key) ?? [];
        cell.push(seg);
        grid.set(key, cell);
      }
    }
    return grid;
  }

  private static _dist2(a: Vec2, b: Vec2): number {
    return (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
  }
}
