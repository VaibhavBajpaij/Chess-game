const socket = io();
const chess = new Chess();
const chessboard = document.querySelector(".chessboard");
const chessPiecesUnicode = {
    p: { w: "♙", b: "♟︎" }, r: { w: "♖", b: "♜" }, n: { w: "♘", b: "♞" },
    b: { w: "♗", b: "♝" }, q: { w: "♕", b: "♛" }, k: { w: "♔", b: "♚" },
};

// --- Persist userId ---
let userId = localStorage.getItem("userId");
if (!userId) {
    userId = Math.random().toString(36).substring(2, 10);
    localStorage.setItem("userId", userId);
}
socket.on("connect", () => {
    socket.emit("register", userId);
});

// State variables
let draggingPiece = null;
let sourceSquare = null;
let playerRole = null;
let roomId = null;
let isWaitingForRandom = false;

// UI Elements
const initialScreen = document.getElementById("initial-screen");
const gameScreen = document.getElementById("game-screen");
const createRoomBtn = document.getElementById("create-room-btn");
const joinRoomBtn = document.getElementById("join-room-btn");
const playRandomBtn = document.getElementById("play-random-btn");
const roomCodeInput = document.getElementById("room-code-input");
const statusMessage = document.getElementById("status-message");
const waitingMessage = document.getElementById("waiting-message");

// Create cancel button if it doesn't exist
let cancelWaitBtn = document.getElementById("cancel-wait-btn");
if (!cancelWaitBtn) {
    cancelWaitBtn = document.createElement("button");
    cancelWaitBtn.id = "cancel-wait-btn";
    cancelWaitBtn.textContent = "Cancel Search";
    cancelWaitBtn.className = "w-full bg-red-600 hover:bg-red-700 px-6 py-3 rounded-lg text-xl transition-colors mt-4 hidden";
    document.querySelector(".space-y-4").appendChild(cancelWaitBtn);
}

// --- UI Event Listeners ---
createRoomBtn.addEventListener("click", () => socket.emit("createRoom", userId));

joinRoomBtn.addEventListener("click", () => {
    const code = roomCodeInput.value.trim();
    if (code) socket.emit("joinRoom", { roomId: code, userId: userId });
});

playRandomBtn.addEventListener("click", () => {
    if (isWaitingForRandom) return;
    
    isWaitingForRandom = true;
    waitingMessage.innerText = "Searching for an opponent...";
    playRandomBtn.disabled = true;
    cancelWaitBtn.classList.remove("hidden");
    socket.emit("playRandom", userId);
});

cancelWaitBtn.addEventListener("click", () => {
    isWaitingForRandom = false;
    waitingMessage.innerText = "";
    playRandomBtn.disabled = false;
    cancelWaitBtn.classList.add("hidden");
    socket.emit("cancelWait", userId);
});

const switchToGameScreen = () => {
    initialScreen.classList.add("hidden");
    gameScreen.classList.remove("hidden");
    isWaitingForRandom = false;
    playRandomBtn.disabled = false;
    cancelWaitBtn.classList.add("hidden");
};

// --- Core Functions ---
const renderBoard = () => {
    const board = chess.board();
    chessboard.innerHTML = "";

    if (playerRole === 'b') chessboard.classList.add("flipped");
    else chessboard.classList.remove("flipped");

    board.forEach((row, rowIndex) => {
        row.forEach((square, colIndex) => {
            const squareDiv = document.createElement("div");
            squareDiv.classList.add("square", (rowIndex + colIndex) % 2 === 0 ? "light" : "dark");
            squareDiv.dataset.row = rowIndex;
            squareDiv.dataset.col = colIndex;

            if (square) {
                const pieceDiv = document.createElement("div");
                pieceDiv.classList.add("piece", square.color === "w" ? "white" : "black");
                pieceDiv.innerHTML = chessPiecesUnicode[square.type][square.color];

                if (playerRole === square.color && chess.turn() === playerRole) {
                    pieceDiv.draggable = true;
                    pieceDiv.classList.add("draggable");
                }

                pieceDiv.addEventListener("dragstart", (e) => {
                    if (pieceDiv.draggable) {
                        draggingPiece = pieceDiv;
                        sourceSquare = { row: rowIndex, col: colIndex };
                        e.dataTransfer.setData("text/plain", "");
                        setTimeout(() => pieceDiv.classList.add("dragging"), 0);
                    }
                });

                pieceDiv.addEventListener("dragend", () => {
                    draggingPiece = null;
                    sourceSquare = null;
                    pieceDiv.classList.remove("dragging");
                });
                squareDiv.appendChild(pieceDiv);
            }

            squareDiv.addEventListener("dragover", (e) => e.preventDefault());
            squareDiv.addEventListener("drop", (e) => {
                e.preventDefault();
                if (draggingPiece) {
                    const targetSquare = {
                        row: parseInt(squareDiv.dataset.row),
                        col: parseInt(squareDiv.dataset.col),
                    };
                    handleMove(sourceSquare, targetSquare);
                }
            });
            chessboard.appendChild(squareDiv);
        });
    });
};

const handleMove = (source, target) => {
    const move = {
        from: `${String.fromCharCode(97 + source.col)}${8 - source.row}`,
        to: `${String.fromCharCode(97 + target.col)}${8 - target.row}`,
        promotion: 'q',
    };
    socket.emit("move", { roomId, move });
};

// --- Socket.IO Event Handlers ---
socket.on("roomCreated", (newRoomId) => {
    roomId = newRoomId;
    statusMessage.innerText = `Game Code: ${newRoomId} - Waiting for opponent...`;
    switchToGameScreen();
});

socket.on("roomJoined", (joinedRoomId) => {
    roomId = joinedRoomId;
    switchToGameScreen();
});

socket.on("playerRole", (role) => {
    playerRole = role;
    renderBoard();
});

socket.on("spectatorRole", () => {
    playerRole = "spectator";
    statusMessage.innerText = "You are watching as a spectator.";
    switchToGameScreen();
});

socket.on("waitingForPlayer", () => {
    waitingMessage.innerText = "Waiting for an opponent to connect...";
});

socket.on("gameStart", (data) => {
    chess.load(data.fen);
    roomId = data.roomId;
    statusMessage.innerText = "Game started! It's White's turn.";
    waitingMessage.innerText = "";
    switchToGameScreen();
    renderBoard();
});

socket.on("boardState", (fen) => {
    chess.load(fen);
    renderBoard();
});

socket.on("move", (move) => {
    chess.move(move);
    const turn = chess.turn() === 'w' ? "White" : "Black";
    statusMessage.innerText = `${turn}'s turn.`;
    renderBoard();
});

socket.on("invalidMove", () => {
    console.log("Invalid move attempted.");
    renderBoard();
});

socket.on("gameOver", (reason) => {
    statusMessage.innerText = `Game Over: ${reason}`;
    document.querySelectorAll('.piece').forEach(p => {
        p.draggable = false;
        p.classList.remove("draggable", "dragging");
    });
});

socket.on("error", (message) => {
    alert(message);
    waitingMessage.innerText = "";
    roomCodeInput.value = "";
    isWaitingForRandom = false;
    playRandomBtn.disabled = false;
    cancelWaitBtn.classList.add("hidden");
});

// Handle disconnect events
socket.on("disconnect", () => {
    isWaitingForRandom = false;
    waitingMessage.innerText = "Disconnected from server. Trying to reconnect...";
});

socket.on("reconnect", () => {
    waitingMessage.innerText = "Reconnected to server.";
    // Re-register with the server
    socket.emit("register", userId);
});