export interface AuthPayload {
  playerId: string;
  walletAddress?: string;
  username: string;
  iat: number;
  exp: number;
}
