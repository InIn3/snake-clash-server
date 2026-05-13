import type { Snake, Vec2 } from '../types';
import { HEAD_COLLISION_RADIUS, ARENA_WIDTH, ARENA_HEIGHT } from './constants';

export interface CollisionEvent {
  victimId:  string;
  killedBy?: string;
}

export class CollisionDetector {
  /**
   * Slither.io rules:
   *  - head hits own body / wall → attacker dies
   *  - head hits another snake's body → BODY OWNER dies (attacker survives)
   *  - head-to-head → smaller snake dies (tie = both die, handled per-snake)
   *
   * Returns all elimination events caused by `snake` this tick.
   */
  static check(snake: Snake, allSnakes: Map<string, Snake>): CollisionEvent[] {
    const head = snake.segments[0];
    if (!head) return [];

    // ── Wall ─────────────────────────────────────────────
    if (head.x <= 0 || head.x >= ARENA_WIDTH || head.y <= 0 || head.y >= ARENA_HEIGHT) {
      return [{ victimId: snake.playerId }];
    }

    // ── Self ─────────────────────────────────────────────
    for (let i = 4; i < snake.segments.length; i++) {
      if (CollisionDetector._dist2(head, snake.segments[i]!) < HEAD_COLLISION_RADIUS ** 2) {
        return [{ victimId: snake.playerId }];
      }
    }

    const events: CollisionEvent[] = [];

    for (const [otherId, other] of allSnakes) {
      if (otherId === snake.playerId || !other.alive) continue;

      // ── Head-to-head ──────────────────────────────────
      const otherHead = other.segments[0]!;
      if (CollisionDetector._dist2(head, otherHead) < (HEAD_COLLISION_RADIUS * 2.2) ** 2) {
        if (snake.length <= other.length) {
          // This snake loses
          return [{ victimId: snake.playerId, killedBy: other.playerId }];
        }
        // This snake wins — the other snake's own check will catch it
        continue;
      }

      // ── Head-into-body (Slither.io: body owner dies) ──
      for (let i = 1; i < other.segments.length; i++) {
        if (CollisionDetector._dist2(head, other.segments[i]!) < HEAD_COLLISION_RADIUS ** 2) {
          events.push({ victimId: other.playerId, killedBy: snake.playerId });
          break;
        }
      }
    }

    return events;
  }

  private static _dist2(a: Vec2, b: Vec2): number {
    return (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
  }
}
