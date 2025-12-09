// SEEDED RNG for Consistent Boards
class SeededRandom {
    constructor(seed) {
        this.seed = seed;
    }

    // Linear Congruential Generator
    next() {
        this.seed = (this.seed * 9301 + 49297) % 233280;
        return this.seed / 233280;
    }
}

class MinesweeperGame {
    constructor(containerId) {
        this.container = document.getElementById(containerId);

        // Configuration
        this.rows = 9;
        this.cols = 9;
        this.minesCount = 10; // Standard Easy (Mobile Friendly)

        // State
        this.grid = [];
        this.revealed = [];
        this.gameOver = false;
        this.cellsToReveal = 0;

        // Networking
        this.mqttClient = null;
        this.myId = 'U' + Math.floor(Math.random() * 100000);
        this.topic = 'jvav/minesweeper/global/v1';

        // Seed based on current hour (Global Sync)
        this.currentSeed = Math.floor(Date.now() / 3600000);

        this.initUI();
        this.connectNetwork();
    }

    connectNetwork() {
        const options = {
            clean: true,
            connectTimeout: 4000,
            clientId: 'jvav_mine_' + Math.random().toString(16).substr(2, 8),
            path: '/mqtt',
        }
        // Using WSS for GitHub Pages (HTTPS) compatibility
        this.client = mqtt.connect('wss://broker.emqx.io:8084/mqtt', options);

        this.client.on('connect', () => {
            console.log('Minesweeper Connected to Global Grid');
            this.client.subscribe(this.topic);
            this.updateStatus('ONLINE: GLOBAL LINK ESTABLISHED', '#00ff00');
        });

        this.client.on('message', (topic, message) => {
            if (topic === this.topic) {
                try {
                    const data = JSON.parse(message.toString());
                    this.handleRemoteEvent(data);
                } catch (e) { console.error('Payload Error', e); }
            }
        });
    }

    handleRemoteEvent(data) {
        // Ignore my own messages
        if (data.user === this.myId) return;

        if (data.type === 'REVEAL') {
            this.floodFill(data.r, data.c, false); // false = don't broadcast back
        } else if (data.type === 'EXPLODE') {
            this.triggerGameOver(data.r, data.c, false);
        }
    }

    initUI() {
        this.container.innerHTML = '';
        this.container.style.textAlign = 'center';
        this.container.style.padding = '20px';
        this.container.style.background = 'rgba(0,0,0,0.4)';
        this.container.style.borderTop = '2px solid #ff0055'; // Danger color
        this.container.style.position = 'relative';

        // Header
        const header = document.createElement('div');
        header.innerHTML = `
            <h2 class="hacker-text" data-value="> GLOBAL MINEFIELD (CO-OP)" style="color:#ff0055; margin-bottom:5px; text-shadow: 0 0 10px #ff0055;">> GLOBAL MINEFIELD (CO-OP)</h2>
            <div id="ms-status" style="font-size:0.8rem; color:#666; margin-bottom:15px; font-family:monospace;">CONNECTING...</div>
        `;
        this.container.appendChild(header);

        // Game Board Container
        this.boardEl = document.createElement('div');
        this.boardEl.style.display = 'grid';
        this.boardEl.style.gap = '1px';
        this.boardEl.style.justifyContent = 'center';
        this.boardEl.style.margin = '20px auto';
        this.boardEl.style.userSelect = 'none';
        this.boardEl.style.background = '#222';
        this.boardEl.style.padding = '5px';
        this.boardEl.style.border = '1px solid #ff0055';
        this.boardEl.style.boxShadow = '0 0 20px rgba(255, 0, 85, 0.2)';

        this.container.appendChild(this.boardEl);

        this.startGame();
    }

    updateStatus(msg, color) {
        const el = document.getElementById('ms-status');
        if (el) {
            el.innerText = msg;
            el.style.color = color;
        }
    }

    startGame() {
        this.gameOver = false;
        this.grid = [];
        this.revealed = [];
        this.boardEl.innerHTML = '';
        this.cellsToReveal = (this.rows * this.cols) - this.minesCount;

        // Use Seeded Random
        const rng = new SeededRandom(this.currentSeed);

        // Setup Grid Style
        const cellSize = 30; // Mobile Friendly
        this.boardEl.style.gridTemplateColumns = `repeat(${this.cols}, ${cellSize}px)`;

        // Init Data
        for (let r = 0; r < this.rows; r++) {
            this.grid[r] = [];
            this.revealed[r] = [];
            for (let c = 0; c < this.cols; c++) {
                this.grid[r][c] = 0;
                this.revealed[r][c] = false;

                // DOM Creation
                const cell = document.createElement('div');
                cell.dataset.r = r;
                cell.dataset.c = c;
                cell.style.width = `${cellSize}px`;
                cell.style.height = `${cellSize}px`;
                cell.style.background = '#1a1a1a';
                cell.style.border = '1px solid #333';
                cell.style.display = 'flex';
                cell.style.alignItems = 'center';
                cell.style.justifyContent = 'center';
                cell.style.cursor = 'crosshair';
                cell.style.fontSize = '16px';
                cell.style.fontWeight = 'bold';
                cell.style.color = '#fff';

                // Click Handler
                // Touch start for faster response on mobile
                cell.addEventListener('mousedown', (e) => this.handleTap(r, c));
                cell.addEventListener('touchstart', (e) => { e.preventDefault(); this.handleTap(r, c); });

                this.boardEl.appendChild(cell);
            }
        }

        // Place Mines Deterministically
        let minesPlaced = 0;
        while (minesPlaced < this.minesCount) {
            const r = Math.floor(rng.next() * this.rows);
            const c = Math.floor(rng.next() * this.cols);
            if (this.grid[r][c] !== -1) {
                this.grid[r][c] = -1;
                minesPlaced++;
            }
        }

        this.calcNumbers();
    }

    calcNumbers() {
        for (let r = 0; r < this.rows; r++) {
            for (let c = 0; c < this.cols; c++) {
                if (this.grid[r][c] === -1) continue;

                let count = 0;
                for (let i = -1; i <= 1; i++) {
                    for (let j = -1; j <= 1; j++) {
                        if (i === 0 && j === 0) continue;
                        const nr = r + i, nc = c + j;
                        if (nr >= 0 && nr < this.rows && nc >= 0 && nc < this.cols && this.grid[nr][nc] === -1) {
                            count++;
                        }
                    }
                }
                this.grid[r][c] = count;
            }
        }
    }

    handleTap(r, c) {
        if (this.gameOver || this.revealed[r][c]) return;

        // Broadcast Move
        if (this.client && this.client.connected) {
            this.client.publish(this.topic, JSON.stringify({
                type: 'REVEAL', r: r, c: c, user: this.myId
            }));
        }

        // Logic
        if (this.grid[r][c] === -1) {
            // Broadcast Explosion
            if (this.client && this.client.connected) {
                this.client.publish(this.topic, JSON.stringify({
                    type: 'EXPLODE', r: r, c: c, user: this.myId
                }));
            }
            this.triggerGameOver(r, c, true);
        } else {
            this.floodFill(r, c, true);
            this.checkWin();
        }
    }

    triggerGameOver(r, c, isLocal) {
        this.gameOver = true;
        this.revealAllMines();
        const cell = this.getCell(r, c);
        if (cell) {
            cell.style.background = 'red';
            cell.style.boxShadow = '0 0 15px red';
        }

        this.updateStatus('CRITICAL FAILURE: MINE DETONATED', '#ff0000');
        if (isLocal) alert('YOU DIED. THE SQUAD HAS FALLED.');
    }

    floodFill(r, c, isLocal) {
        if (r < 0 || r >= this.rows || c < 0 || c >= this.cols || this.revealed[r][c]) return;

        this.revealed[r][c] = true;
        this.cellsToReveal--;

        const cell = this.getCell(r, c);
        if (!cell) return;

        cell.style.background = '#2a2a2a';
        cell.style.border = '1px solid #444';

        if (!isLocal) {
            cell.style.boxShadow = 'inset 0 0 10px rgba(0, 255, 255, 0.2)'; // Highlight remote clicks
        }

        const val = this.grid[r][c];
        if (val > 0) {
            cell.innerText = val;
            cell.style.color = this.getNumberColor(val);
        } else {
            // Empty cell, recurse
            for (let i = -1; i <= 1; i++) {
                for (let j = -1; j <= 1; j++) {
                    this.floodFill(r + i, c + j, isLocal);
                }
            }
        }
    }

    checkWin() {
        if (this.cellsToReveal === 0) {
            this.gameOver = true;
            this.updateStatus('SECTOR CLEARED. EXCELLENT WORK.', '#00ff00');
            alert('VICTORY ACHIEVED');
        }
    }

    getCell(r, c) {
        return this.boardEl.querySelector(`div[data-r="${r}"][data-c="${c}"]`);
    }

    revealAllMines() {
        for (let r = 0; r < this.rows; r++) {
            for (let c = 0; c < this.cols; c++) {
                if (this.grid[r][c] === -1) {
                    const cell = this.getCell(r, c);
                    if (cell) {
                        cell.innerText = 'X';
                        cell.style.color = 'red';
                        cell.style.background = '#500';
                    }
                }
            }
        }
    }

    getNumberColor(n) {
        const colors = [null, '#00ffff', '#00ff00', '#ff00ff', '#ffff00', '#ff0000', '#00ffff', '#00ffff', '#00ffff'];
        return colors[n] || '#fff';
    }
}

// Export
window.MinesweeperGame = MinesweeperGame;
