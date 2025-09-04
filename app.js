const express = require("express");
const { Server } = require('socket.io');
const http = require("http");
const { Chess } = require("chess.js");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// --- State Management ---
const rooms = new Map();
let waitingPlayer = null;
const userSocketMap = new Map(); // Maps userId -> socket object
const disconnectTimeouts = new Map(); // Maps userId -> timeoutID for disconnect grace period

app.set("view engine", "ejs");
app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => {
    res.render("index", { title: "Chess Game" });
});

// Helper function to handle user association and reconnection logic
const handleUserAssociation = (userId, socket) => {
    // Only associate if it hasn't been done for this connection
    if (socket.userId) return;

    socket.userId = userId;
    userSocketMap.set(userId, socket);
    console.log(`User ${userId} associated with socket ${socket.id}`);

    // If this user is reconnecting, clear their disconnect timeout
    if (disconnectTimeouts.has(userId)) {
        clearTimeout(disconnectTimeouts.get(userId));
        disconnectTimeouts.delete(userId);
        console.log(`User ${userId} reconnected within grace period.`);

        // Try to rejoin them to their game
        for (const [roomId, room] of rooms.entries()) {
            if (room.players.white === userId || room.players.black === userId) {
                socket.join(roomId);
                const playerRole = room.players.white === userId ? 'w' : 'b';
                socket.emit("playerRole", playerRole);
                socket.emit("gameStart", { fen: room.chess.fen(), roomId: roomId });
                console.log(`Rejoining ${userId} to room ${roomId}`);
                break;
            }
        }
    }
};

io.on("connection", (socket) => {
    console.log("A user connected:", socket.id);

    // --- Associate userId immediately on connect for reconnection purposes ---
    socket.on('register', (userId) => {
        handleUserAssociation(userId, socket);
    });

    // --- Room Creation ---
   socket.on("createRoom", (userId) => {  // Changed to accept userId parameter
    handleUserAssociation(userId, socket);
    const roomId = Math.random().toString(36).substring(2, 7);
    socket.join(roomId);
    rooms.set(roomId, {
        players: { white: socket.userId, black: null },
        chess: new Chess(),
    });
    socket.emit("roomCreated", roomId);
    socket.emit("playerRole", "w");
});

    // --- Join Room ---
    socket.on("joinRoom", (data) => {
        const { roomId, userId } = data;
        handleUserAssociation(userId, socket); // Ensure user is associated
        if (rooms.has(roomId)) {
            const room = rooms.get(roomId);
            if (room.players.white === socket.userId) return; // Can't join own game

            if (!room.players.black) {
                socket.join(roomId);
                room.players.black = socket.userId;
                socket.emit("roomJoined", roomId);
                socket.emit("playerRole", "b");
                io.to(roomId).emit("gameStart", { fen: room.chess.fen(), roomId });
            } else {
                socket.join(roomId);
                socket.emit("spectatorRole");
                socket.emit("boardState", room.chess.fen());
            }
        } else {
            socket.emit("error", "Room not found.");
        }
    });

    // --- Play with Random ---
    socket.on("playRandom", (userId) => {
        handleUserAssociation(userId, socket); // Ensure user is associated
        
          if (waitingPlayer && waitingPlayer !== userId) {
        const opponentUserId = waitingPlayer;
        const opponentSocket = userSocketMap.get(opponentUserId);
        
        if (!opponentSocket || !opponentSocket.connected) {
            waitingPlayer = userId; // Opponent is stale, this player now waits
            socket.emit("waitingForPlayer");
            return;
        }
        
        waitingPlayer = null; // Match found

        const roomId = Math.random().toString(36).substring(2, 7);
        const room = {
            players: { white: opponentUserId, black: userId },
            chess: new Chess(),
        };
        rooms.set(roomId, room);

        opponentSocket.join(roomId);
        socket.join(roomId);
        
        opponentSocket.emit("playerRole", "w");
        socket.emit("playerRole", "b");
        io.to(roomId).emit("gameStart", { fen: room.chess.fen(), roomId });
    } else {
        waitingPlayer = userId;  // Store userId instead of socket
        socket.emit("waitingForPlayer");
    }
});

    // --- Move Handling ---
    socket.on("move", ({ roomId, move }) => {
        if (!socket.userId) return;
        try {
            if (rooms.has(roomId)) {
                const room = rooms.get(roomId);
                const chess = room.chess;
                const turn = chess.turn();
                
                if ((turn === 'w' && socket.userId !== room.players.white) || (turn === 'b' && socket.userId !== room.players.black)) return;
                
                const result = chess.move(move);
                if (result) {
                    io.to(roomId).emit("move", move);
                    if (chess.isGameOver()) {
                        let reason = "Game Over";
                        const winner = chess.turn() === 'w' ? 'Black' : 'White';
                        if (chess.isCheckmate()) reason = `Checkmate! ${winner} wins.`;
                        else if (chess.isDraw()) reason = "It's a draw!";
                        else if (chess.isStalemate()) reason = "Stalemate! Draw.";
                        io.to(roomId).emit("gameOver", reason);
                    }
                } else {
                    socket.emit("invalidMove", move);
                }
            }
        } catch (error) {
            console.error(`Error during move: ${error.message}`);
            socket.emit("invalidMove", move);
        }
    });

    // --- Disconnect Handling ---
    socket.on("disconnect", () => {
        const userId = socket.userId;
        console.log("User disconnected:", socket.id, `(User ID: ${userId})`);

        if (waitingPlayer && waitingPlayer.id === socket.id) {
            waitingPlayer = null;
        }

        if (userId) {
            const timeout = setTimeout(() => {
                console.log(`Grace period expired for ${userId}. Cleaning up.`);
                userSocketMap.delete(userId); 
                disconnectTimeouts.delete(userId);

                for (const [roomId, room] of rooms.entries()) {
                    if (room.players.white === userId || room.players.black === userId) {
                        const otherPlayerId = room.players.white === userId ? room.players.black : room.players.white;
                        if (otherPlayerId && userSocketMap.has(otherPlayerId)) {
                             io.to(roomId).emit("gameOver", "Opponent disconnected. You win!");
                        }
                        rooms.delete(roomId);
                        break;
                    }
                }
            }, 5000); 
            disconnectTimeouts.set(userId, timeout);
        }
    });
});

server.listen(3000, () => {
    console.log("Server is running on port 3000");
});

