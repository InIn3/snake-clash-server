import type { Server, Socket } from 'socket.io';
import { GameRoom } from '../game/GameRoom';
import { logger } from '../utils/logger';
import { config } from '../config';
import type { Player } from '../types';

type Mode = 'CASUAL' | 'RANKED' | 'TOURNAMENT';

interface QueueEntry {
  socket: Socket;
  player: Player;
  skinId: string;
  mode:   Mode;
  joinedAt: number;
}

export class MatchmakingService {
  private io: Server;

  // Active game rooms: roomId → GameRoom
  private rooms = new Map<string, GameRoom>();

  // Per-mode waiting queues
  private queues: Record<Mode, QueueEntry[]> = {
    CASUAL:     [],
    RANKED:     [],
    TOURNAMENT: [],
  };

  // How long to wait before force-starting with fewer than max players
  private readonly QUEUE_TIMEOUT_MS = 15_000;

  constructor(io: Server) {
    this.io = io;
    // Periodic queue processing
    setInterval(() => this._processQueues(), 2000);
    // Periodic room cleanup
    setInterval(() => this._cleanRooms(), 30_000);
  }

  // ── Public API ────────────────────────────────────────────

  enqueue(socket: Socket, player: Player, skinId: string, mode: Mode = 'CASUAL'): void {
    // Prevent duplicate queuing
    this._dequeue(socket.id);

    const entry: QueueEntry = { socket, player, skinId, mode, joinedAt: Date.now() };
    this.queues[mode].push(entry);

    const position = this.queues[mode].length;
    socket.emit('server:queued', { position, mode, estimatedWait: position * 3 });

    logger.info({ playerId: player.id, mode, queueLen: position }, 'Player queued');
    this._processQueues();
  }

  dequeue(socketId: string): void {
    this._dequeue(socketId);
  }

  handleDisconnect(socketId: string): void {
    this._dequeue(socketId);
    // Remove from all rooms
    this.rooms.forEach(room => room.removePlayer(socketId));
  }

  getRoomForSocket(socketId: string): GameRoom | null {
    for (const room of this.rooms.values()) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if ((room as any)['socketToPlayer']?.has(socketId)) {
        return room;
      }
    }
    return null;
  }

  getRoom(roomId: string): GameRoom | null {
    return this.rooms.get(roomId) ?? null;
  }

  getRoomCount():   number { return this.rooms.size; }
  getQueueCount():  number {
    return Object.values(this.queues).reduce((s, q) => s + q.length, 0);
  }

  // ── Queue processing ──────────────────────────────────────

  private _processQueues() {
    for (const mode of Object.keys(this.queues) as Mode[]) {
      const queue = this.queues[mode];
      if (queue.length === 0) continue;

      // Find existing room with space
      let targetRoom: GameRoom | null = null;
      for (const room of this.rooms.values()) {
        if (room.getPhase() === 'WAITING' && !room.isFull() && room.mode === mode) {
          targetRoom = room;
          break;
        }
      }

      // Create new room if none available
      if (!targetRoom) {
        targetRoom = new GameRoom(this.io, mode, config.game.maxPlayers);
        this.rooms.set(targetRoom.getRoomId(), targetRoom);
        logger.info({ roomId: targetRoom.getRoomId(), mode }, 'New room created');
      }

      // Move queued players into the room
      while (queue.length > 0 && !targetRoom.isFull()) {
        const entry = queue.shift()!;

        // Stale socket check
        if (!entry.socket.connected) continue;

        const joined = targetRoom.addPlayer(entry.socket, entry.player, entry.skinId);
        if (!joined) {
          // Room filled while we were iterating — requeue
          queue.unshift(entry);
          break;
        }
      }
    }
  }

  private _dequeue(socketId: string) {
    for (const queue of Object.values(this.queues)) {
      const idx = queue.findIndex(e => e.socket.id === socketId);
      if (idx !== -1) queue.splice(idx, 1);
    }
  }

  private _cleanRooms() {
    for (const [id, room] of this.rooms) {
      if (room.getPhase() === 'ENDED' || room.isEmpty()) {
        room.destroy();
        this.rooms.delete(id);
        logger.info({ roomId: id }, 'Room cleaned up');
      }
    }
  }
}
