// server.ts
import { serve } from "https://deno.land/std@0.200.0/http/server.ts";
import { acceptWebSocket, acceptable } from "https://deno.land/std@0.200.0/ws/mod.ts";

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

interface Winner {
  playerId: string;
  playerName: string;
  pattern: string;
  prize: number;
  timestamp: Date;
}

interface GameState {
  players: Map<string, Player>;
  calledNumbers: number[];
  gameActive: boolean;
  winners: Winner[];
  settings: {
    serviceFee: number;
    winPercentage: number;
    callInterval: number;
    gameType: string;
    maxNumbers: number;
  };
  adminConnections: Set<WebSocket>;
  autoCallIntervalId: number | null;
}

class BingoServer {
  private gameState: GameState;
  private connections: Map<WebSocket, { type: 'player' | 'admin', playerId?: string }> = new Map();

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
        gameType: '75ball',
        maxNumbers: 75
      },
      adminConnections: new Set(),
      autoCallIntervalId: null
    };
  }

  async handleRequest(req: Request): Promise<Response> {
    const url = new URL(req.url);
    
    // Handle WebSocket connections
    if (req.headers.get("upgrade") === "websocket") {
      if (acceptable(req)) {
        const { socket, response } = Deno.upgradeWebSocket(req);
        this.handleWebSocket(socket);
        return response;
      }
      return new Response("WebSocket upgrade failed", { status: 400 });
    }
    
    // Handle HTTP requests
    if (url.pathname === "/health") {
      return new Response(JSON.stringify({
        status: "ok",
        players: this.gameState.players.size,
        gameActive: this.gameState.gameActive
      }), {
        headers: { "Content-Type": "application/json" }
      });
    }
    
    // Default response
    return new Response(JSON.stringify({
      name: "አሰፋ ቢንጎ ሰርቨር",
      version: "1.0.0",
      endpoints: ["/health", "/ws"]
    }), {
      headers: { "Content-Type": "application/json" }
    });
  }

  private handleWebSocket(socket: WebSocket) {
    console.log("New WebSocket connection established");
    
    socket.onopen = () => {
      console.log("WebSocket connection opened");
    };

    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        this.handleMessage(socket, data);
      } catch (error) {
        console.error("Error parsing message:", error);
        this.sendError(socket, "Invalid message format");
      }
    };

    socket.onclose = () => {
      console.log("WebSocket connection closed");
      this.handleDisconnection(socket);
    };

    socket.onerror = (error) => {
      console.error("WebSocket error:", error);
    };
  }

  private handleMessage(socket: WebSocket, data: any) {
    const { type, data: payload } = data;

    switch (type) {
      case 'setAdmin':
        this.handleSetAdmin(socket);
        break;
      
      case 'joinGame':
        this.handleJoinGame(socket, payload);
        break;
      
      case 'markNumber':
        this.handleMarkNumber(socket, payload);
        break;
      
      case 'claimBingo':
        this.handleClaimBingo(socket, payload);
        break;
      
      case 'adminStartGame':
        this.handleAdminStartGame(socket);
        break;
      
      case 'adminPauseGame':
        this.handleAdminPauseGame(socket);
        break;
      
      case 'adminResetGame':
        this.handleAdminResetGame(socket);
        break;
      
      case 'adminCallNumber':
        this.handleAdminCallNumber(socket);
        break;
      
      case 'adminCallSpecific':
        this.handleAdminCallSpecific(socket, payload);
        break;
      
      case 'adminToggleAutoCall':
        this.handleAdminToggleAutoCall(socket, payload);
        break;
      
      case 'adminUpdateSettings':
        this.handleAdminUpdateSettings(socket, payload);
        break;
      
      default:
        this.sendError(socket, 'Unknown message type');
    }
  }

  private handleSetAdmin(socket: WebSocket) {
    this.gameState.adminConnections.add(socket);
    this.connections.set(socket, { type: 'admin' });
    
    this.sendToSocket(socket, {
      type: 'gameState',
      data: this.getPublicGameState()
    });
    
    console.log('Admin connected');
  }

  private handleJoinGame(socket: WebSocket, playerData: any) {
    const player: Player = {
      id: playerData.id || `player_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      name: playerData.name,
      stake: playerData.stake || 25,
      boardType: playerData.boardType || '75ball',
      board: this.generateBoard(playerData.boardType || '75ball'),
      markedNumbers: new Set(),
      socket: socket,
      connected: true,
      joinedAt: new Date(),
      lastActivity: new Date()
    };

    this.gameState.players.set(player.id, player);
    this.connections.set(socket, { type: 'player', playerId: player.id });

    // Send board to player
    this.sendToSocket(socket, {
      type: 'board',
      data: player.board
    });

    // Send current game state
    this.sendToSocket(socket, {
      type: 'gameState',
      data: this.getPublicGameState()
    });

    // Notify everyone about new player
    this.broadcast({
      type: 'playerJoined',
      data: {
        id: player.id,
        name: player.name,
        stake: player.stake,
        boardType: player.boardType
      }
    }, [socket]); // Exclude the new player

    // Update admin panels
    this.updateAdmins();

    console.log(`Player joined: ${player.name} (${player.id})`);
  }

  private generateBoard(boardType: string): any {
    switch (boardType) {
      case '75ball':
        return this.generate75BallBoard();
      case '90ball':
        this.gameState.settings.maxNumbers = 90;
        return this.generate90BallBoard();
      case '30ball':
        this.gameState.settings.maxNumbers = 30;
        return this.generate30BallBoard();
      case 'pattern':
        const board = this.generate75BallBoard();
        board.pattern = this.getRandomPattern();
        return board;
      case 'coverall':
        this.gameState.settings.maxNumbers = 90;
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
    
    const board: any = { 
      numbers: [], 
      type: '75ball',
      layout: '5x5'
    };
    
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
          marked: row === 2 && col === 2,
          row: row,
          col: col
        };
      }
    }
    
    return board;
  }

  private generate90BallBoard(): any {
    const board: any = { 
      numbers: [], 
      type: '90ball',
      layout: '9x3'
    };
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
      
      // Each column gets exactly 3 numbers (one in each row, but blank spaces allowed)
      const numCount = 3; // Fixed 3 numbers per column for 90-ball
      
      while (numbers.size < numCount) {
        numbers.add(Math.floor(Math.random() * (max - min + 1)) + min);
      }
      
      const sortedNumbers = Array.from(numbers).sort((a, b) => a - b);
      
      // Assign to rows 0, 1, 2 (some will be null for blank spaces)
      for (let row = 0; row < 3; row++) {
        if (row < sortedNumbers.length) {
          board.numbers[row][col] = {
            number: sortedNumbers[row],
            column: col + 1,
            marked: false,
            row: row,
            col: col
          };
        } else {
          board.numbers[row][col] = {
            number: null,
            column: col + 1,
            marked: false,
            blank: true,
            row: row,
            col: col
          };
        }
      }
    }
    
    return board;
  }

  private generate30BallBoard(): any {
    const board: any = { 
      numbers: [], 
      type: '30ball',
      layout: '3x3'
    };
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
          marked: false,
          row: i,
          col: j
        };
      }
    }
    
    return board;
  }

  private generateCoverallBoard(): any {
    const board: any = { 
      numbers: [], 
      type: 'coverall',
      layout: '9x5'
    };
    const allNumbers = Array.from({ length: 90 }, (_, i) => i + 1);
    const shuffled = this.shuffleArray([...allNumbers]);
    const selectedNumbers = shuffled.slice(0, 45);
    
    for (let i = 0; i < 5; i++) {
      board.numbers[i] = [];
      for (let j = 0; j < 9; j++) {
        const index = i * 9 + j;
        if (index < 45) {
          board.numbers[i][j] = {
            number: selectedNumbers[index],
            marked: false,
            row: i,
            col: j
          };
        }
      }
    }
    
    return board;
  }

  private getRandomPattern(): string {
    const patterns = ['x-pattern', 'frame', 'postage-stamp', 'small-diamond'];
    return patterns[Math.floor(Math.random() * patterns.length)];
  }

  private shuffleArray<T>(array: T[]): T[] {
    const newArray = [...array];
    for (let i = newArray.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
    }
    return newArray;
  }

  private handleMarkNumber(socket: WebSocket, payload: any) {
    const connection = this.connections.get(socket);
    if (!connection || connection.type !== 'player' || !connection.playerId) return;

    const player = this.gameState.players.get(connection.playerId);
    if (!player) return;

    const { number } = payload;
    if (number && number !== 'FREE') {
      player.markedNumbers.add(Number(number));
      player.lastActivity = new Date();
    }
  }

  private handleClaimBingo(socket: WebSocket, payload: any) {
    const connection = this.connections.get(socket);
    if (!connection || connection.type !== 'player' || !connection.playerId) return;

    const player = this.gameState.players.get(connection.playerId);
    if (!player) return;

    const { pattern } = payload;
    
    // Verify the claim
    if (this.verifyBingo(player, pattern)) {
      const prize = this.calculatePrize(player.stake);
      
      const winner: Winner = {
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

      console.log(`Bingo verified! ${player.name} won ${prize} with pattern ${pattern}`);
    } else {
      this.sendError(socket, 'Bingo claim could not be verified');
    }
  }

  private verifyBingo(player: Player, pattern: string): boolean {
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
      case 'one-line':
        return markedCount >= 5;
      case 'two-lines':
        return markedCount >= 10;
      case 'full-board':
        return markedCount >= 45;
      case 'x-pattern':
      case 'frame':
      case 'postage-stamp':
      case 'small-diamond':
        return markedCount >= 5;
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
    
    // Distribute among current players
    return Math.floor(afterFee / Math.max(this.gameState.players.size, 1));
  }

  private handleAdminStartGame(socket: WebSocket) {
    if (!this.gameState.adminConnections.has(socket)) {
      this.sendError(socket, 'Unauthorized');
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

  private handleAdminPauseGame(socket: WebSocket) {
    if (!this.gameState.adminConnections.has(socket)) {
      this.sendError(socket, 'Unauthorized');
      return;
    }

    this.gameState.gameActive = false;
    
    // Stop auto-call if running
    if (this.gameState.autoCallIntervalId !== null) {
      clearInterval(this.gameState.autoCallIntervalId);
      this.gameState.autoCallIntervalId = null;
    }
    
    this.broadcast({
      type: 'gameState',
      data: this.getPublicGameState()
    });

    console.log('Game paused by admin');
  }

  private handleAdminResetGame(socket: WebSocket) {
    if (!this.gameState.adminConnections.has(socket)) {
      this.sendError(socket, 'Unauthorized');
      return;
    }

    this.gameState.calledNumbers = [];
    this.gameState.winners = [];
    this.gameState.gameActive = false;
    
    // Reset all players' marked numbers
    this.gameState.players.forEach(player => {
      player.markedNumbers.clear();
    });

    // Stop auto-call
    if (this.gameState.autoCallIntervalId !== null) {
      clearInterval(this.gameState.autoCallIntervalId);
      this.gameState.autoCallIntervalId = null;
    }

    this.broadcast({
      type: 'gameState',
      data: this.getPublicGameState()
    });

    console.log('Game reset by admin');
  }

  private handleAdminCallNumber(socket: WebSocket) {
    if (!this.gameState.adminConnections.has(socket)) {
      this.sendError(socket, 'Unauthorized');
      return;
    }

    if (!this.gameState.gameActive) {
      this.sendError(socket, 'Game is not active');
      return;
    }

    const maxNumber = this.gameState.settings.maxNumbers;
    let number: number;
    let attempts = 0;
    
    do {
      number = Math.floor(Math.random() * maxNumber) + 1;
      attempts++;
      if (attempts > maxNumber * 2) {
        this.sendError(socket, 'Unable to find unused number');
        return;
      }
    } while (this.gameState.calledNumbers.includes(number));

    this.gameState.calledNumbers.push(number);
    
    this.broadcast({
      type: 'numberCalled',
      data: { 
        number, 
        timestamp: new Date().toISOString(),
        totalCalled: this.gameState.calledNumbers.length
      }
    });

    console.log(`Number called: ${number}`);
  }

  private handleAdminCallSpecific(socket: WebSocket, payload: any) {
    if (!this.gameState.adminConnections.has(socket)) {
      this.sendError(socket, 'Unauthorized');
      return;
    }

    const { number } = payload;
    
    if (!number || number < 1 || number > this.gameState.settings.maxNumbers) {
      this.sendError(socket, 'Invalid number');
      return;
    }
    
    if (this.gameState.calledNumbers.includes(number)) {
      this.sendError(socket, 'Number already called');
      return;
    }

    this.gameState.calledNumbers.push(number);
    
    this.broadcast({
      type: 'numberCalled',
      data: { 
        number, 
        timestamp: new Date().toISOString(),
        totalCalled: this.gameState.calledNumbers.length
      }
    });

    console.log(`Specific number called: ${number}`);
  }

  private handleAdminToggleAutoCall(socket: WebSocket, payload: any) {
    if (!this.gameState.adminConnections.has(socket)) {
      this.sendError(socket, 'Unauthorized');
      return;
    }

    const { enabled } = payload;
    
    if (enabled && this.gameState.autoCallIntervalId === null) {
      const interval = (this.gameState.settings.callInterval || 7) * 1000;
      this.gameState.autoCallIntervalId = setInterval(() => {
        if (this.gameState.gameActive) {
          this.handleAdminCallNumber(socket);
        }
      }, interval);
      console.log('Auto-call enabled');
    } else if (!enabled && this.gameState.autoCallIntervalId !== null) {
      clearInterval(this.gameState.autoCallIntervalId);
      this.gameState.autoCallIntervalId = null;
      console.log('Auto-call disabled');
    }
  }

  private handleAdminUpdateSettings(socket: WebSocket, payload: any) {
    if (!this.gameState.adminConnections.has(socket)) {
      this.sendError(socket, 'Unauthorized');
      return;
    }

    this.gameState.settings = { 
      ...this.gameState.settings, 
      ...payload 
    };
    
    // Update auto-call interval if it's running
    if (this.gameState.autoCallIntervalId !== null) {
      clearInterval(this.gameState.autoCallIntervalId);
      const interval = this.gameState.settings.callInterval * 1000;
      this.gameState.autoCallIntervalId = setInterval(() => {
        if (this.gameState.gameActive) {
          this.handleAdminCallNumber(socket);
        }
      }, interval);
    }

    this.updateAdmins();
    console.log('Settings updated:', this.gameState.settings);
  }

  private handleDisconnection(socket: WebSocket) {
    const connection = this.connections.get(socket);
    
    if (connection) {
      if (connection.type === 'admin') {
        this.gameState.adminConnections.delete(socket);
        console.log('Admin disconnected');
      } else if (connection.type === 'player' && connection.playerId) {
        const player = this.gameState.players.get(connection.playerId);
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
          }, [socket]);

          console.log(`Player disconnected: ${player.name}`);
        }
      }
      
      this.connections.delete(socket);
    }
    
    this.updateAdmins();
  }

  private getPublicGameState() {
    const playersArray = Array.from(this.gameState.players.values()).map(p => ({
      id: p.id,
      name: p.name,
      stake: p.stake,
      boardType: p.boardType,
      connected: p.connected,
      markedCount: p.markedNumbers.size
    }));

    return {
      players: playersArray,
      calledNumbers: this.gameState.calledNumbers,
      gameActive: this.gameState.gameActive,
      winners: this.gameState.winners.slice(-10).map(w => ({
        ...w,
        timestamp: w.timestamp.toISOString()
      })),
      settings: this.gameState.settings,
      currentPot: this.calculateCurrentPot(),
      stats: {
        totalPlayers: playersArray.length,
        connectedPlayers: playersArray.filter(p => p.connected).length,
        numbersCalled: this.gameState.calledNumbers.length,
        numbersRemaining: this.gameState.settings.maxNumbers - this.gameState.calledNumbers.length
      }
    };
  }

  private calculateCurrentPot(): number {
    const totalStakes = Array.from(this.gameState.players.values())
      .filter(p => p.connected)
      .reduce((sum, p) => sum + p.stake, 0);
    
    const { winPercentage, serviceFee } = this.gameState.settings;
    
    return Math.floor(totalStakes * (winPercentage / 100) * ((100 - serviceFee) / 100));
  }

  private broadcast(message: any, exclude: WebSocket[] = []) {
    const data = JSON.stringify(message);
    
    // Broadcast to all players
    this.gameState.players.forEach(player => {
      if (player.connected && player.socket.readyState === WebSocket.OPEN && !exclude.includes(player.socket)) {
        try {
          player.socket.send(data);
        } catch (error) {
          console.error('Error broadcasting to player:', error);
        }
      }
    });

    // Broadcast to all admins
    this.gameState.adminConnections.forEach(socket => {
      if (socket.readyState === WebSocket.OPEN && !exclude.includes(socket)) {
        try {
          socket.send(data);
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

    this.gameState.adminConnections.forEach(socket => {
      if (socket.readyState === WebSocket.OPEN) {
        try {
          socket.send(JSON.stringify(message));
        } catch (error) {
          console.error('Error updating admin:', error);
        }
      }
    });
  }

  private sendToSocket(socket: WebSocket, message: any) {
    if (socket.readyState === WebSocket.OPEN) {
      try {
        socket.send(JSON.stringify(message));
      } catch (error) {
        console.error('Error sending to socket:', error);
      }
    }
  }

  private sendError(socket: WebSocket, message: string) {
    this.sendToSocket(socket, {
      type: 'error',
      data: { 
        message,
        timestamp: new Date().toISOString()
      }
    });
  }
}

// Create server instance
const bingoServer = new BingoServer();

// Get port from environment or default to 8080
const port = parseInt(Deno.env.get("PORT") || "8080");

console.log(`Starting Bingo server on port ${port}...`);
console.log(`WebSocket endpoint: ws://localhost:${port}`);
console.log(`Health check: http://localhost:${port}/health`);

// Start the server
serve(bingoServer.handleRequest.bind(bingoServer), { port });
