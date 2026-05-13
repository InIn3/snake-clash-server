import type { Snake, Direction, Vec2 } from '../types';
import { CELL_SIZE, SNAKE_SPEED, BOOST_SPEED, ARENA_WIDTH, ARENA_HEIGHT } from './constants';

export class SnakePhysics {
  // Advance snake one tick. Returns the new head position and whether it ate food.
  static move(snake: Snake, ate: boolean): { head: Vec2; poppedTail: Vec2 | null } {
    const speed  = snake.boosting ? BOOST_SPEED : SNAKE_SPEED;
    const distPerTick = (speed / 60) * (1000 / 20); // px moved per tick at 20 ticks/s

    const prevHead = snake.segments[0]!;
    const dirVec   = SnakePhysics.dirVec(snake.direction);
    const head: Vec2 = {
      x: prevHead.x + dirVec.x * distPerTick,
      y: prevHead.y + dirVec.y * distPerTick,
    };

    // Clamp to arena boundaries (wall = death, handled by collision checker)
    head.x = Math.max(0, Math.min(ARENA_WIDTH,  head.x));
    head.y = Math.max(0, Math.min(ARENA_HEIGHT, head.y));

    // Add new head
    snake.segments.unshift(head);

    // Pop tail unless snake ate food this tick
    let poppedTail: Vec2 | null = null;
    if (!ate) {
      poppedTail = snake.segments.pop() ?? null;
    } else {
      snake.length++;
    }

    return { head, poppedTail };
  }

  static dirVec(dir: Direction): Vec2 {
    return (
      dir === 'UP'    ? { x: 0,  y: -1 } :
      dir === 'DOWN'  ? { x: 0,  y:  1 } :
      dir === 'LEFT'  ? { x: -1, y:  0 } :
                        { x:  1, y:  0 }
    );
  }

  static opposite(dir: Direction): Direction {
    return { UP: 'DOWN', DOWN: 'UP', LEFT: 'RIGHT', RIGHT: 'LEFT' }[dir] as Direction;
  }

  // Server-authoritative direction validation
  static validateDirection(current: Direction, requested: Direction): Direction {
    // Cannot reverse 180 degrees
    if (requested === SnakePhysics.opposite(current)) return current;
    return requested;
  }

  static isOutOfBounds(pos: Vec2): boolean {
    return pos.x < 0 || pos.x > ARENA_WIDTH || pos.y < 0 || pos.y > ARENA_HEIGHT;
  }

  // Boost drains length over time
  static applyBoostDrain(snake: Snake, deltaMs: number): boolean {
    if (!snake.boosting || snake.length <= 5) return false;
    const drain = (0.8 / 1000) * deltaMs; // 0.8 segments/s
    snake.boostDrainAccum = (snake.boostDrainAccum ?? 0) + drain;
    if (snake.boostDrainAccum >= 1) {
      const toPop = Math.floor(snake.boostDrainAccum);
      snake.boostDrainAccum -= toPop;
      for (let i = 0; i < toPop && snake.segments.length > 3; i++) {
        snake.segments.pop();
        snake.length = Math.max(3, snake.length - 1);
      }
      return true;
    }
    return false;
  }
}
