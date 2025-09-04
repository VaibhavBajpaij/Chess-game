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

// UI Elements
const initialScreen = document.getElementById("initial-screen");
const gameScreen = document.getElementById("game-screen");
const createRoomBtn = document.getElementById("create-room-btn");
const joinRoomBtn = document.getElementById("join-room-btn");
const playRandomBtn = document.getElementById("play-random-btn");
const roomCodeInput = document.getElementById("room-code-input");
const statusMessage = document.getElementById("status-message");
const waitingMessage = document.getElementById("waiting-message");

// --- UI Event Listeners ---
// FIX 1: Add userId parameter to createRoom
createRoomBtn.addEventListener("click", () => socket.emit("createRoom", userId));

// FIX 2: Send an object with roomId and userId for joinRoom
joinRoomBtn.addEventListener("click", () => {
    const code = roomCodeInput.value.trim();
    if (code) socket.emit("joinRoom", { roomId: code, userId: userId });
});

// FIX 3: Add userId parameter to playRandom
playRandomBtn.addEventListener("click", () => {
    waitingMessage.innerText = "Searching for an opponent...";
    socket.emit("playRandom", userId);
});

const switchToGameScreen = () => {
    initialScreen.classList.add("hidden");
    gameScreen.classList.remove("hidden");
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
socket.on("gameStart", (initialFen) => {
    chess.load(initialFen);
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
});