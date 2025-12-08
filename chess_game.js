/**
 * chess_game.js
 * Multiplayer Chess & Xiangqi Center
 */

class ChessGameManager {
    constructor() {
        this.myId = 'player_' + Math.floor(Math.random() * 100000);
        this.brokerUrl = "broker.emqx.io";
        this.port = 8084;
        this.topic = "jvav/games/update";

        // MQTT Client shared for games?
        // Actually, to avoid connection limits, let's try to use one client.
        // But for simplicity in this file, we keep using this one.

        this.chessGame = new InternationalChess(this);
        this.xiangqiGame = new XiangqiSandbox(this);

        this.connectMQTT();
    }

    connectMQTT() {
        if (typeof Paho === 'undefined') return;

        this.client = new Paho.MQTT.Client(this.brokerUrl, this.port, this.myId);

        this.client.onConnectionLost = (res) => {
            console.log("Game Service Lost:", res);
        };

        this.client.onMessageArrived = (msg) => {
            try {
                const data = JSON.parse(msg.payloadString);
                if (data.sender === this.myId) return;

                if (data.game === 'chess') this.chessGame.handleSync(data);
                if (data.game === 'xiangqi') this.xiangqiGame.handleSync(data);

            } catch (e) { console.error(e); }
        };

        this.client.connect({
            onSuccess: () => {
                console.log("Game Service Connected");
                this.client.subscribe(this.topic);
                this.publish({ type: 'ask_state' });
            },
            useSSL: true
        });
    }

    publish(data) {
        if (this.client && this.client.isConnected()) {
            const msg = new Paho.MQTT.Message(JSON.stringify({ ...data, sender: this.myId }));
            msg.destinationName = this.topic;
            this.client.send(msg);
        }
    }
}

/**
 * International Chess (Strict Rules)
 */
class InternationalChess {
    constructor(manager) {
        this.manager = manager;
        this.game = new Chess();
        this.board = null;
        this.role = 'spectator';
        this.lastMoveTime = Date.now();
        this.players = { w: null, b: null };

        this.initUI();
    }

    initUI() {
        const config = {
            draggable: true,
            position: 'start',
            pieceTheme: 'https://chessboardjs.com/img/chesspieces/wikipedia/{piece}.png',
            onDragStart: (src, piece) => this.onDragStart(src, piece),
            onDrop: (src, tgt) => this.onDrop(src, tgt),
            onSnapEnd: () => this.board.position(this.game.fen())
        };
        this.board = Chessboard('board-chess', config);

        $('#btn-chess-sit-w').on('click', () => this.trySit('w'));
        $('#btn-chess-sit-b').on('click', () => this.trySit('b'));

        this.updateStatus();
    }

    onDragStart(source, piece) {
        if (this.game.game_over()) return false;
        if (this.role === 'spectator') return false;
        if (this.role === 'white' && piece.search(/^b/) !== -1) return false;
        if (this.role === 'black' && piece.search(/^w/) !== -1) return false;
        if ((this.game.turn() === 'w' && this.role !== 'white') ||
            (this.game.turn() === 'b' && this.role !== 'black')) {
            return false;
        }
    }

    onDrop(source, target) {
        const move = this.game.move({
            from: source,
            to: target,
            promotion: 'q'
        });

        if (move === null) return 'snapback';

        this.lastMoveTime = Date.now();
        this.updateStatus();

        this.manager.publish({
            game: 'chess',
            type: 'move',
            fen: this.game.fen(),
            pgn: this.game.pgn(),
            players: this.players
        });
    }

    trySit(color) {
        const now = Date.now();
        const currentPlayerId = this.players[color];

        if (!currentPlayerId || (now - this.lastMoveTime > 60000)) {
            this.role = (color === 'w') ? 'white' : 'black';
            this.players[color] = this.manager.myId;
            this.lastMoveTime = now;
            this.board.orientation(color === 'w' ? 'white' : 'black');

            this.updateStatus();
            this.manager.publish({
                game: 'chess',
                type: 'sit',
                players: this.players,
                fen: this.game.fen()
            });
            alert(`You are now playing ${color === 'w' ? 'White' : 'Black'}!`);
        } else {
            alert("This seat is taken!");
        }
    }

    handleSync(data) {
        if (data.type === 'move' || data.type === 'state') {
            this.game.load(data.fen);
            this.board.position(data.fen);
            this.players = data.players || this.players;
            this.lastMoveTime = Date.now();
            this.updateStatus();
        } else if (data.type === 'sit') {
            this.players = data.players;
            if (this.players.w !== this.manager.myId && this.players.b !== this.manager.myId) {
                this.role = 'spectator';
            }
            this.updateStatus();
        } else if (data.type === 'ask_state') {
            if (this.role !== 'spectator') {
                this.manager.publish({
                    game: 'chess',
                    type: 'state',
                    fen: this.game.fen(),
                    players: this.players
                });
            }
        }
    }

    updateStatus() {
        let status = '';
        const moveColor = this.game.turn() === 'b' ? 'Black' : 'White';

        if (this.game.in_checkmate()) {
            status = 'Game over, ' + moveColor + ' is in checkmate.';
        } else if (this.game.in_draw()) {
            status = 'Game over, drawn position';
        } else {
            status = moveColor + ' to move';
            if (this.game.in_check()) status += ', ' + moveColor + ' is in check';
        }

        const wName = this.players.w ? (this.players.w === this.manager.myId ? 'You' : 'Online') : 'Empty';
        const bName = this.players.b ? (this.players.b === this.manager.myId ? 'You' : 'Online') : 'Empty';

        $('#status-chess').html(`${status}<br>White: ${wName} | Black: ${bName}`);
    }
}

/**
 * Xiangqi Sandbox (Turn-Based Enforcement)
 */
class XiangqiSandbox {
    constructor(manager) {
        this.manager = manager;
        this.container = document.getElementById('board-xiangqi');
        this.role = 'spectator';
        this.pieces = [];
        this.selectedPiece = null;
        this.lastMoveTime = Date.now();
        this.players = { r: null, b: null };
        this.turn = 'red';

        this.initBoard();
        this.initPieces();

        $('#btn-xiangqi-sit-r').on('click', () => this.trySit('r'));
        $('#btn-xiangqi-sit-b').on('click', () => this.trySit('b'));
        $('#btn-xiangqi-reset').on('click', () => this.resetGame());
    }

    initBoard() {
        this.container.style.display = 'grid';
        this.container.style.gridTemplateColumns = 'repeat(9, 1fr)';
        this.container.style.gridTemplateRows = 'repeat(10, 1fr)';

        for (let y = 0; y < 10; y++) {
            for (let x = 0; x < 9; x++) {
                const cell = document.createElement('div');
                cell.style.width = '100%';
                cell.style.height = '100%';
                cell.style.position = 'relative';

                cell.dataset.x = x;
                cell.dataset.y = y;
                cell.addEventListener('click', (e) => this.onCellClick(x, y));

                const hLine = document.createElement('div');
                hLine.style.position = 'absolute';
                hLine.style.height = '1px';
                hLine.style.background = '#000';
                hLine.style.top = '50%';
                hLine.style.left = (x === 0 ? '50%' : '0');
                hLine.style.width = (x === 8 ? '50%' : '100%');
                cell.appendChild(hLine);

                const vLine = document.createElement('div');
                vLine.style.position = 'absolute';
                vLine.style.width = '1px';
                vLine.style.background = '#000';
                vLine.style.left = '50%';
                vLine.style.top = (y === 0 ? '50%' : '0');
                vLine.style.height = (y === 9 ? '50%' : '100%');

                if (y === 4) vLine.style.height = '50%';
                if (y === 5) { vLine.style.top = '0'; vLine.style.height = '50%'; }

                cell.appendChild(vLine);
                this.container.appendChild(cell);
            }
        }
    }

    initPieces() {
        const setup = [
            { id: 'r_c_1', t: '車', c: 'red', x: 0, y: 9 }, { id: 'r_m_1', t: '馬', c: 'red', x: 1, y: 9 },
            { id: 'r_x_1', t: '相', c: 'red', x: 2, y: 9 }, { id: 'r_s_1', t: '仕', c: 'red', x: 3, y: 9 },
            { id: 'r_j_1', t: '帥', c: 'red', x: 4, y: 9 }, { id: 'r_s_2', t: '仕', c: 'red', x: 5, y: 9 },
            { id: 'r_x_2', t: '相', c: 'red', x: 6, y: 9 }, { id: 'r_m_2', t: '馬', c: 'red', x: 7, y: 9 },
            { id: 'r_c_2', t: '車', c: 'red', x: 8, y: 9 },
            { id: 'r_p_1', t: '炮', c: 'red', x: 1, y: 7 }, { id: 'r_p_2', t: '炮', c: 'red', x: 7, y: 7 },
            { id: 'r_z_1', t: '兵', c: 'red', x: 0, y: 6 }, { id: 'r_z_2', t: '兵', c: 'red', x: 2, y: 6 },
            { id: 'r_z_3', t: '兵', c: 'red', x: 4, y: 6 }, { id: 'r_z_4', t: '兵', c: 'red', x: 6, y: 6 },
            { id: 'r_z_5', t: '兵', c: 'red', x: 8, y: 6 },

            { id: 'b_c_1', t: '車', c: 'black', x: 0, y: 0 }, { id: 'b_m_1', t: '馬', c: 'black', x: 1, y: 0 },
            { id: 'b_x_1', t: '象', c: 'black', x: 2, y: 0 }, { id: 'b_s_1', t: '士', c: 'black', x: 3, y: 0 },
            { id: 'b_j_1', t: '將', c: 'black', x: 4, y: 0 }, { id: 'b_s_2', t: '士', c: 'black', x: 5, y: 0 },
            { id: 'b_x_2', t: '象', c: 'black', x: 6, y: 0 }, { id: 'b_m_2', t: '馬', c: 'black', x: 7, y: 0 },
            { id: 'b_c_2', t: '車', c: 'black', x: 8, y: 0 },
            { id: 'b_p_1', t: '炮', c: 'black', x: 1, y: 2 }, { id: 'b_p_2', t: '炮', c: 'black', x: 7, y: 2 },
            { id: 'b_z_1', t: '卒', c: 'black', x: 0, y: 3 }, { id: 'b_z_2', t: '卒', c: 'black', x: 2, y: 3 },
            { id: 'b_z_3', t: '卒', c: 'black', x: 4, y: 3 }, { id: 'b_z_4', t: '卒', c: 'black', x: 6, y: 3 },
            { id: 'b_z_5', t: '卒', c: 'black', x: 8, y: 3 },
        ];

        this.pieces = setup;
        this.turn = 'red';
        this.renderPieces();
        this.updateStatus();
    }

    renderPieces() {
        const existing = this.container.querySelectorAll('.xq-piece');
        existing.forEach(e => e.remove());

        this.pieces.forEach(p => {
            const div = document.createElement('div');
            div.className = 'xq-piece';
            div.innerText = p.t;
            div.style.position = 'absolute';
            div.style.width = '30px';
            div.style.height = '30px';
            div.style.borderRadius = '50%';
            div.style.background = '#f0c070';
            div.style.color = p.c === 'red' ? '#d00' : '#000';
            div.style.border = `2px solid ${p.c === 'red' ? '#d00' : '#000'}`;
            div.style.textAlign = 'center';
            div.style.lineHeight = '26px';
            div.style.fontWeight = 'bold';
            div.style.fontSize = '18px';
            div.style.cursor = 'pointer';
            div.style.zIndex = '10';
            div.style.transition = 'all 0.2s';

            const w = this.container.clientWidth / 9;
            const h = this.container.clientHeight / 10;
            div.style.left = (p.x * w + w / 2 - 15) + 'px';
            div.style.top = (p.y * h + h / 2 - 15) + 'px';

            if (this.selectedPiece && this.selectedPiece.id === p.id) {
                div.style.background = '#fff';
                div.style.transform = 'scale(1.2)';
            }

            div.addEventListener('click', (e) => {
                e.stopPropagation();
                this.onPieceClick(p);
            });

            this.container.appendChild(div);
        });
    }

    onPieceClick(p) {
        if (this.role === 'spectator') return;

        if (this.turn !== this.role) return;

        // Select own
        if (p.c === this.role) {
            this.selectedPiece = p;
            this.renderPieces();
            return;
        }

        // Capture
        if (this.selectedPiece && p.c !== this.role) {
            this.movePiece(this.selectedPiece, p.x, p.y);
        }
    }

    onCellClick(x, y) {
        if (this.role === 'spectator') return;
        if (this.turn !== this.role) return;

        if (this.selectedPiece) {
            this.movePiece(this.selectedPiece, x, y);
        }
    }

    movePiece(piece, x, y) {
        const targetIndex = this.pieces.findIndex(p => p.x === x && p.y === y && p.id !== piece.id);
        if (targetIndex !== -1) {
            this.pieces.splice(targetIndex, 1);
        }

        piece.x = x;
        piece.y = y;
        this.selectedPiece = null;

        this.turn = (this.turn === 'red' ? 'black' : 'red');

        this.lastMoveTime = Date.now();
        this.renderPieces();
        this.updateStatus();
        this.broadcastState();
    }

    trySit(color) {
        const now = Date.now();
        const cid = this.players[color];
        if (!cid || (now - this.lastMoveTime > 60000)) {
            this.role = color;
            this.players[color] = this.manager.myId;
            this.lastMoveTime = now;
            this.broadcastState();
            alert(`Playing ${color === 'r' ? 'RED' : 'BLACK'}`);
        } else {
            alert("Seat taken.");
        }
    }

    resetGame() {
        if (this.role === 'spectator') return;
        if (!confirm("Reset Board?")) return;
        this.initPieces();
        this.broadcastState();
    }

    broadcastState() {
        this.manager.publish({
            game: 'xiangqi',
            type: 'state',
            pieces: this.pieces,
            players: this.players,
            turn: this.turn
        });
    }

    handleSync(data) {
        if (data.type === 'state') {
            this.pieces = data.pieces;
            this.players = data.players || this.players;
            this.turn = data.turn || 'red';
            this.lastMoveTime = Date.now();
            this.renderPieces();
            this.updateStatus();
        } else if (data.type === 'ask_state' && this.role !== 'spectator') {
            this.broadcastState();
        }
    }

    updateStatus() {
        const rName = this.players.r ? (this.players.r === this.manager.myId ? 'You' : 'Online') : 'Empty';
        const bName = this.players.b ? (this.players.b === this.manager.myId ? 'You' : 'Online') : 'Empty';

        const turnText = this.turn === 'red' ? '<span style="color:#f00">RED TURN</span>' : '<span style="color:#000; background:#ccc">BLACK TURN</span>';

        $('#status-xiangqi').html(`${turnText}<br>Red: ${rName} | Black: ${bName}`);
    }
}
