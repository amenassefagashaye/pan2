// server.ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { WebSocket, WebSocketServer } from "https://deno.land/x/websocket@v0.1.4/mod.ts";

interface Player {
  id: string;
  name: string;
  stake: number;
  boardType: string;
  board: any;
  markedNumbers: Set<number>;
  socket: WebSocket;
  connected: boolean;
  joinedAt: Date;
  lastActivity: Date;
}

interface GameState {
  players: Map<string, Player>;
  calledNumbers: number[];
  gameActive: boolean;
  winners: Array<{
    playerId: string;
    playerName: string;
    pattern: string;
    prize: number;
    timestamp: Date;
  }>;
  settings: {
    serviceFee: number;
    winPercentage: number;
    callInterval: number;
    gameType: string;
  };
  adminSockets: Set<WebSocket>;
  autoCallInterval: number | null;
}

class BingoServer {
  private gameState: GameState;
  private wss: WebSocketServer;

  constructor() {
    this.gameState = {
      players: new Map(),
      calledNumbers: [],
      gameActive: false,
      winners: [],
      settings: {
        serviceFee: 3,
        winPercentage: 80,
        callInterval: 7,
        gameType: '75ball'
      },
      adminSockets: new Set(),
      autoCallInterval: null
    };

    this.wss = new WebSocketServer(8080);
    this.setupWebSocketServer();
  }

  private setupWebSocketServer() {
    console.log('Bingo WebSocket server running on ws://localhost:8080');

    this.wss.on("connection", (ws: WebSocket) => {
      console.log('New connection established');

      ws.on("message", (message: string) => {
        try {
          const data = JSON.parse(message);
          this.handleMessage(ws, data);
        } catch (error) {
          console.error('Error parsing message:', error);
          this.sendError(ws, 'Invalid message format');
        }
      });

      ws.on("close", () => {
        this.handleDisconnection(ws);
      });

      ws.on("error", (error: Error) => {
        console.error('WebSocket error:', error);
      });
    });
  }

  private handleMessage(ws: WebSocket, data: any) {
    const { type, data: payload } = data;

    switch (type) {
      case 'setAdmin':
        this.handleSetAdmin(ws);
        break;
      
      case 'joinGame':
        this.handleJoinGame(ws, payload);
        break;
      
      case 'markNumber':
        this.handleMarkNumber(ws, payload);
        break;
      
      case 'claimBingo':
        this.handleClaimBingo(ws, payload);
        break;
      
      case 'adminStartGame':
        this.handleAdminStartGame(ws);
        break;
      
      case 'adminPauseGame':
        this.handleAdminPauseGame(ws);
        break;
      
      case 'adminResetGame':
        this.handleAdminResetGame(ws);
        break;
      
      case 'adminCallNumber':
        this.handleAdminCallNumber(ws);
        break;
      
      case 'adminCallSpecific':
        this.handleAdminCallSpecific(ws, payload);
        break;
      
      case 'adminToggleAutoCall':
        this.handleAdminToggleAutoCall(ws, payload);
        break;
      
      case 'adminUpdateSettings':
        this.handleAdminUpdateSettings(ws, payload);
        break;
      
      default:
        this.sendError(ws, 'Unknown message type');
    }
  }

  private handleSetAdmin(ws: WebSocket) {
    this.gameState.adminSockets.add(ws);
    this.sendToSocket(ws, {
      type: 'gameState',
      data: this.getPublicGameState()
    });
    console.log('Admin connected');
  }

  private handleJoinGame(ws: WebSocket, playerData: any) {
    const player: Player = {
      id: playerData.id,
      name: playerData.name,
      stake: playerData.stake,
      boardType: playerData.boardType,
      board: this.generateBoard(playerData.boardType),
      markedNumbers: new Set(),
      socket: ws,
      connected: true,
      joinedAt: new Date(),
      lastActivity: new Date()
    };

    this.gameState.players.set(player.id, player);

    // Send board to player
    this.sendToSocket(ws, {
      type: 'board',
      data: player.board
    });

    // Send current game state
    this.sendToSocket(ws, {
      type: 'gameState',
      data: this.getPublicGameState()
    });

    // Notify everyone about new player
    this.broadcast({
      type: 'playerJoined',
      data: {
        id: player.id,
        name: player.name,
        stake: player.stake
      }
    }, [ws]); // Exclude the new player

    // Update admin panels
    this.updateAdmins();

    console.log(`Player joined: ${player.name} (${player.id})`);
  }

  private generateBoard(boardType: string): any {
    switch (boardType) {
      case '75ball':
        return this.generate75BallBoard();
      case '90ball':
        return this.generate90BallBoard();
      case '30ball':
        return this.generate30BallBoard();
      case 'pattern':
        const board = this.generate75BallBoard();
        board.pattern = this.getRandomPattern();
        return board;
      case 'coverall':
        return this.generateCoverallBoard();
      default:
        return this.generate75BallBoard();
    }
  }

  private generate75BallBoard(): any {
    const columns = [
      { min: 1, max: 15, letter: 'B' },
      { min: 16, max: 30, letter: 'I' },
      { min: 31, max: 45, letter: 'N' },
      { min: 46, max: 60, letter: 'G' },
      { min: 61, max: 75, letter: 'O' }
    ];
    
    const board: any = { numbers: [], type: '75ball' };
    
    for (let col = 0; col < 5; col++) {
      const columnNumbers = new Set<number>();
      const { min, max } = columns[col];
      
      while (columnNumbers.size < 5) {
        columnNumbers.add(Math.floor(Math.random() * (max - min + 1)) + min);
      }
      
      const sortedNumbers = Array.from(columnNumbers).sort((a, b) => a - b);
      
      for (let row = 0; row < 5; row++) {
        if (!board.numbers[row]) board.numbers[row] = [];
        board.numbers[row][col] = {
          number: row === 2 && col === 2 ? 'FREE' : sortedNumbers[row],
          letter: columns[col].letter,
          marked: row === 2 && col === 2
        };
      }
    }
    
    return board;
  }

  private generate90BallBoard(): any {
    const board: any = { numbers: [], type: '90ball' };
    const ranges = [
      [1,10], [11,20], [21,30], [31,40], [41,50],
      [51,60], [61,70], [71,80], [81,90]
    ];
    
    // Initialize 3x9 grid
    for (let i = 0; i < 3; i++) {
      board.numbers[i] = new Array(9).fill(null);
    }
    
    for (let col = 0; col < 9; col++) {
      const [min, max] = ranges[col];
      const numbers = new Set<number>();
      
      // Each column gets 1-3 numbers
      const numCount = Math.floor(Math.random() * 3) + 1;
      
      while (numbers.size < numCount) {
        numbers.add(Math.floor(Math.random() * (max - min + 1)) + min);
      }
      
      const sortedNumbers = Array.from(numbers).sort((a, b) => a - b);
      const positions = [0, 1, 2].sort(() => Math.random() - 0.5);
      
      for (let i = 0; i < numCount; i++) {
        board.numbers[positions[i]][col] = {
          number: sortedNumbers[i],
          column: col + 1,
          marked: false
        };
      }
    }
    
    return board;
  }

  private getRandomPattern(): string {
    const patterns = ['x-pattern', 'frame', 'postage-stamp', 'small-diamond'];
    return patterns[Math.floor(Math.random() * patterns.length)];
  }

  private handleMarkNumber(ws: WebSocket, payload: any) {
    const player = this.findPlayerBySocket(ws);
    if (!player) return;

    const { number } = payload;
    player.markedNumbers.add(number);
    player.lastActivity = new Date();

    // Check for potential win
    this.checkPlayerWin(player);
  }

  private handleClaimBingo(ws: WebSocket, payload: any) {
    const player = this.findPlayerBySocket(ws);
    if (!player) return;

    const { pattern } = payload;
    
    // Verify the claim
    if (this.verifyBingo(player, pattern)) {
      const prize = this.calculatePrize(player.stake);
      
      const winner = {
        playerId: player.id,
        playerName: player.name,
        pattern: pattern,
        prize: prize,
        timestamp: new Date()
      };

      this.gameState.winners.push(winner);

      // Announce winner to all
      this.broadcast({
        type: 'winnerAnnounced',
        data: winner
      });

      // Reset player's marked numbers for next game
      player.markedNumbers.clear();

      console.log(`Bingo verified! ${player.name} won ${prize} with pattern ${pattern}`);
    } else {
      this.sendError(ws, 'Bingo claim could not be verified');
    }
  }

  private verifyBingo(player: Player, pattern: string): boolean {
    // Simple verification - check if player has marked enough numbers
    // In production, you'd want to verify the exact pattern
    const markedCount = player.markedNumbers.size;
    
    switch (pattern) {
      case 'full-house':
        return markedCount >= 24; // 25 cells minus free space
      case 'row':
      case 'column':
      case 'diagonal':
        return markedCount >= 5;
      case 'four-corners':
        return markedCount >= 4;
      default:
        return markedCount >= 5;
    }
  }

  private calculatePrize(stake: number): number {
    const totalStakes = Array.from(this.gameState.players.values())
      .reduce((sum, p) => sum + p.stake, 0);
    
    const { winPercentage, serviceFee } = this.gameState.settings;
    
    const prizePool = totalStakes * (winPercentage / 100);
    const afterFee = prizePool * ((100 - serviceFee) / 100);
    
    // Simple prize calculation - in production, you might want more complex logic
    return Math.floor(afterFee / Math.max(this.gameState.players.size, 1));
  }

  private handleAdminStartGame(ws: WebSocket) {
    if (!this.gameState.adminSockets.has(ws)) {
      this.sendError(ws, 'Unauthorized');
      return;
    }

    this.gameState.gameActive = true;
    this.gameState.calledNumbers = [];
    
    this.broadcast({
      type: 'gameState',
      data: this.getPublicGameState()
    });

    console.log('Game started by admin');
  }

  private handleAdminPauseGame(ws: WebSocket) {
    if (!this.gameState.adminSockets.has(ws)) {
      this.sendError(ws, 'Unauthorized');
      return;
    }

    this.gameState.gameActive = false;
    
    this.broadcast({
      type: 'gameState',
      data: this.getPublicGameState()
    });

    console.log('Game paused by admin');
  }

  private handleAdminResetGame(ws: WebSocket) {
    if (!this.gameState.adminSockets.has(ws)) {
      this.sendError(ws, 'Unauthorized');
      return;
    }

    this.gameState.calledNumbers = [];
    this.gameState.winners = [];
    
    // Reset all players' marked numbers
    this.gameState.players.forEach(player => {
      player.markedNumbers.clear();
    });

    this.broadcast({
      type: 'gameState',
      data: this.getPublicGameState()
    });

    console.log('Game reset by admin');
  }

  private handleAdminCallNumber(ws: WebSocket) {
    if (!this.gameState.adminSockets.has(ws)) {
      this.sendError(ws, 'Unauthorized');
      return;
    }

    if (!this.gameState.gameActive) {
      this.sendError(ws, 'Game is not active');
      return;
    }

    const maxNumber = this.gameState.settings.gameType === '90ball' ? 90 : 75;
    let number: number;
    
    do {
      number = Math.floor(Math.random() * maxNumber) + 1;
    } while (this.gameState.calledNumbers.includes(number) && 
             this.gameState.calledNumbers.length < maxNumber);

    if (this.gameState.calledNumbers.length >= maxNumber) {
      this.sendError(ws, 'All numbers have been called');
      return;
    }

    this.gameState.calledNumbers.push(number);
    
    this.broadcast({
      type: 'numberCalled',
      data: { number, timestamp: new Date() }
    });

    console.log(`Number called: ${number}`);
  }

  private handleAdminCallSpecific(ws: WebSocket, payload: any) {
    if (!this.gameState.adminSockets.has(ws)) {
      this.sendError(ws, 'Unauthorized');
      return;
    }

    const { number } = payload;
    
    if (this.gameState.calledNumbers.includes(number)) {
      this.sendError(ws, 'Number already called');
      return;
    }

    this.gameState.calledNumbers.push(number);
    
    this.broadcast({
      type: 'numberCalled',
      data: { number, timestamp: new Date() }
    });

    console.log(`Specific number called: ${number}`);
  }

  private handleAdminToggleAutoCall(ws: WebSocket, payload: any) {
    if (!this.gameState.adminSockets.has(ws)) {
      this.sendError(ws, 'Unauthorized');
      return;
    }

    const { enabled } = payload;
    
    if (enabled && !this.gameState.autoCallInterval) {
      const interval = this.gameState.settings.callInterval * 1000;
      this.gameState.autoCallInterval = setInterval(() => {
        if (this.gameState.gameActive) {
          this.handleAdminCallNumber(ws);
        }
      }, interval);
      console.log('Auto-call enabled');
    } else if (!enabled && this.gameState.autoCallInterval) {
      clearInterval(this.gameState.autoCallInterval);
      this.gameState.autoCallInterval = null;
      console.log('Auto-call disabled');
    }
  }

  private handleAdminUpdateSettings(ws: WebSocket, payload: any) {
    if (!this.gameState.adminSockets.has(ws)) {
      this.sendError(ws, 'Unauthorized');
      return;
    }

    this.gameState.settings = { ...this.gameState.settings, ...payload };
    
    // Update auto-call interval if it's running
    if (this.gameState.autoCallInterval) {
      clearInterval(this.gameState.autoCallInterval);
      const interval = this.gameState.settings.callInterval * 1000;
      this.gameState.autoCallInterval = setInterval(() => {
        if (this.gameState.gameActive) {
          this.handleAdminCallNumber(ws);
        }
      }, interval);
    }

    this.updateAdmins();
    console.log('Settings updated:', this.gameState.settings);
  }

  private handleDisconnection(ws: WebSocket) {
    // Remove from admins
    this.gameState.adminSockets.delete(ws);

    // Find and update player
    const player = this.findPlayerBySocket(ws);
    if (player) {
      player.connected = false;
      player.lastActivity = new Date();
      
      // Notify others
      this.broadcast({
        type: 'playerLeft',
        data: {
          id: player.id,
          name: player.name
        }
      }, [ws]);

      console.log(`Player disconnected: ${player.name}`);
    }

    this.updateAdmins();
  }

  private findPlayerBySocket(ws: WebSocket): Player | null {
    for (const player of this.gameState.players.values()) {
      if (player.socket === ws) {
        return player;
      }
    }
    return null;
  }

  private checkPlayerWin(player: Player) {
    // This is a simplified check
    // In production, you'd want to check specific patterns
    const markedCount = player.markedNumbers.size;
    
    // For demonstration, auto-win at 5 marks
    if (markedCount >= 5 && !this.gameState.winners.some(w => w.playerId === player.id)) {
      this.sendToSocket(player.socket, {
        type: 'bingoReady',
        data: { pattern: 'quick-win' }
      });
    }
  }

  private getPublicGameState() {
    return {
      players: Array.from(this.gameState.players.values()).map(p => ({
        id: p.id,
        name: p.name,
        stake: p.stake,
        connected: p.connected
      })),
      calledNumbers: this.gameState.calledNumbers,
      gameActive: this.gameState.gameActive,
      winners: this.gameState.winners.slice(-10), // Last 10 winners
      settings: this.gameState.settings,
      currentPot: this.calculateCurrentPot()
    };
  }

  private calculateCurrentPot(): number {
    const totalStakes = Array.from(this.gameState.players.values())
      .reduce((sum, p) => sum + p.stake, 0);
    
    const { winPercentage, serviceFee } = this.gameState.settings;
    
    return Math.floor(totalStakes * (winPercentage / 100) * ((100 - serviceFee) / 100));
  }

  private broadcast(message: any, exclude: WebSocket[] = []) {
    const data = JSON.stringify(message);
    
    // Broadcast to all players
    this.gameState.players.forEach(player => {
      if (player.connected && !exclude.includes(player.socket)) {
        try {
          player.socket.send(data);
        } catch (error) {
          console.error('Error broadcasting to player:', error);
        }
      }
    });

    // Broadcast to all admins
    this.gameState.adminSockets.forEach(ws => {
      if (!exclude.includes(ws)) {
        try {
          ws.send(data);
        } catch (error) {
          console.error('Error broadcasting to admin:', error);
        }
      }
    });
  }

  private updateAdmins() {
    const message = {
      type: 'gameState',
      data: this.getPublicGameState()
    };

    this.gameState.adminSockets.forEach(ws => {
      try {
        ws.send(JSON.stringify(message));
      } catch (error) {
        console.error('Error updating admin:', error);
      }
    });
  }

  private sendToSocket(ws: WebSocket, message: any) {
    try {
      ws.send(JSON.stringify(message));
    } catch (error) {
      console.error('Error sending to socket:', error);
    }
  }

  private sendError(ws: WebSocket, message: string) {
    this.sendToSocket(ws, {
      type: 'error',
      data: { message }
    });
  }

  // Additional board generation methods
  private generate30BallBoard(): any {
    const board: any = { numbers: [], type: '30ball' };
    const numbers = new Set<number>();
    
    while (numbers.size < 9) {
      numbers.add(Math.floor(Math.random() * 30) + 1);
    }
    
    const sortedNumbers = Array.from(numbers).sort((a, b) => a - b);
    
    for (let i = 0; i < 3; i++) {
      board.numbers[i] = [];
      for (let j = 0; j < 3; j++) {
        const index = i * 3 + j;
        board.numbers[i][j] = {
          number: sortedNumbers[index],
          marked: false
        };
      }
    }
    
    return board;
  }

  private generateCoverallBoard(): any {
    const board: any = { numbers: [], type: 'coverall' };
    const allNumbers = Array.from({ length: 90 }, (_, i) => i + 1);
    const selectedNumbers = this.shuffleArray(allNumbers).slice(0, 45);
    
    for (let i = 0; i < 5; i++) {
      board.numbers[i] = [];
      for (let j = 0; j < 9; j++) {
        const index = i * 9 + j;
        if (index < 45) {
          board.numbers[i][j] = {
            number: selectedNumbers[index],
            marked: false
          };
        }
      }
    }
    
    return board;
  }

  private shuffleArray(array: number[]): number[] {
    const newArray = [...array];
    for (let i = newArray.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
    }
    return newArray;
  }
}

// Start the server
const server = new BingoServer();