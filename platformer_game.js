/**
 * platformer_game.js
 * 2D Side-Scrolling Shooter (Smash-style) using MQTT
 */

class PlatformerGame {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas.getContext('2d');

        // Config
        this.brokerUrl = "broker.emqx.io";
        this.port = 8084;
        this.topic = "jvav/platformer/update";
        this.myId = 'smash_' + Math.floor(Math.random() * 100000);

        // Physics Constants
        this.GRAVITY = 0.5;
        this.FRICTION = 0.8;
        this.JUMP_FORCE = -12;
        this.MOVE_SPEED = 1;
        this.MAX_SPEED = 5;

        // Map
        this.platforms = [
            { x: 0, y: 350, w: 800, h: 50 }, // Floor
            { x: 150, y: 250, w: 150, h: 10 },
            { x: 500, y: 200, w: 150, h: 10 },
            { x: 350, y: 120, w: 100, h: 10 }
        ];

        // State
        this.playing = false;
        this.connected = false;
        this.me = {
            x: 400, y: 200,
            vx: 0, vy: 0,
            hp: 100, color: '#ff00ff', angle: 0,
            grounded: false,
            cooldown: 0
        };
        this.others = {};
        this.bullets = [];
        this.keys = {};

        // Listeners
        this.bindEvents();

        // Loop
        this.lastTime = Date.now();
        requestAnimationFrame(() => this.loop());
    }

    bindEvents() {
        // UI
        const joinBtn = document.getElementById('btn-join-platformer');
        const overlay = document.getElementById('platformer-overlay');

        const start = (e) => {
            if (e && e.type === 'touchstart') e.preventDefault();
            this.joinGame();
        };

        if (joinBtn) {
            joinBtn.addEventListener('click', start);
            joinBtn.addEventListener('touchstart', start);
        }

        if (overlay) {
            overlay.addEventListener('click', (e) => {
                if (e.target === overlay || e.target.tagName === 'H3' || e.target.tagName === 'P') {
                    start(e);
                }
            });
        }

        // Input
        window.addEventListener('keydown', (e) => {
            if (!this.playing) return;
            this.keys[e.key.toLowerCase()] = true;
            // Jump on W or Space
            if ((e.key === 'w' || e.key === ' ') && this.me.grounded) {
                this.me.vy = this.JUMP_FORCE;
                this.me.grounded = false;
            }
        });
        window.addEventListener('keyup', (e) => {
            if (!this.playing) return;
            this.keys[e.key.toLowerCase()] = false;
        });

        this.canvas.addEventListener('mousemove', (e) => {
            if (!this.playing) return;
            const rect = this.canvas.getBoundingClientRect();
            const scaleX = this.canvas.width / rect.width;
            const scaleY = this.canvas.height / rect.height;

            const mx = (e.clientX - rect.left) * scaleX;
            const my = (e.clientY - rect.top) * scaleY;

            this.me.angle = Math.atan2(my - this.me.y, mx - this.me.x);
        });

        this.canvas.addEventListener('mousedown', () => {
            if (this.playing && this.me.hp > 0) this.shoot();
        });

        this.canvas.addEventListener('touchstart', (e) => {
            e.preventDefault();
            if (this.playing && this.me.hp > 0) this.shoot();
        }, { passive: false });
    }

    joinGame() {
        if (!this.connected) this.connectMQTT();
        document.getElementById('platformer-overlay').style.display = 'none';
        document.getElementById('platformer-hud').style.display = 'block';
        this.playing = true;
        this.respawn();
    }

    respawn() {
        this.me.hp = 100;
        this.me.x = 400;
        this.me.y = 100; // Drop from sky
        this.me.vx = 0;
        this.me.vy = 0;
        this.updateHUD();
    }

    connectMQTT() {
        if (typeof Paho === 'undefined') return;
        this.client = new Paho.MQTT.Client(this.brokerUrl, this.port, this.myId);
        this.client.onConnectionLost = () => { this.connected = false; };
        this.client.onMessageArrived = (msg) => this.handleMessage(msg);
        this.client.connect({
            onSuccess: () => {
                this.connected = true;
                this.client.subscribe(this.topic);
            },
            useSSL: true
        });
    }

    handleMessage(msg) {
        try {
            const data = JSON.parse(msg.payloadString);
            if (data.id === this.myId) return;

            if (data.type === 'update') {
                this.others[data.id] = {
                    x: data.x, y: data.y, angle: data.angle, hp: data.hp,
                    color: data.color, lastSeen: Date.now()
                };
            } else if (data.type === 'shoot') {
                this.bullets.push({
                    x: data.x, y: data.y,
                    vx: Math.cos(data.angle) * 15, // Faster bullets
                    vy: Math.sin(data.angle) * 15,
                    owner: data.id,
                    life: 60
                });
            } else if (data.type === 'hit') {
                if (data.target === this.myId) this.takeDamage(10);
            }
        } catch (e) { }
    }

    publish(data) {
        if (this.connected) {
            const msg = new Paho.MQTT.Message(JSON.stringify({ ...data, id: this.myId }));
            msg.destinationName = this.topic;
            this.client.send(msg);
        }
    }

    shoot() {
        if (this.me.cooldown > 0) return;

        const speed = 15;
        this.bullets.push({
            x: this.me.x, y: this.me.y,
            vx: Math.cos(this.me.angle) * speed,
            vy: Math.sin(this.me.angle) * speed,
            owner: this.myId,
            life: 60
        });

        this.publish({ type: 'shoot', x: this.me.x, y: this.me.y, angle: this.me.angle });
        this.me.cooldown = 5;
    }

    takeDamage(amount) {
        if (this.me.hp <= 0) return;
        this.me.hp -= amount;
        this.updateHUD();
        if (this.me.hp <= 0) {
            this.playing = false;
            document.getElementById('platformer-overlay').style.display = 'flex';
            document.getElementById('platformer-overlay').innerHTML = `
                <h3 style="color:red">K.O.</h3>
                <button id="btn-respawn-plat" style="margin-top:20px; padding:10px;">RESPAWN</button>
            `;
            document.getElementById('btn-respawn-plat').addEventListener('click', () => {
                this.restoreOverlay();
                this.joinGame();
            });
        }
    }

    restoreOverlay() {
        document.getElementById('platformer-overlay').innerHTML = `
             <h3 style="color: #ff00ff; font-family: 'Share Tech Mono'; font-size: 2rem; margin: 0;">SMASH ARENA</h3>
             <p style="color: #fff; margin: 10px 0;">WASD/Space to Jump | Click to Shoot</p>
             <button id="btn-join-platformer" style="padding: 10px 30px; font-size: 1.2rem; background: #ff00ff; color: #fff; border: none; font-family: 'Share Tech Mono'; cursor: pointer; margin-top: 10px;">JOIN GAME</button>
             <div id="platformer-status" style="color: #ccc; margin-top: 10px; font-size: 0.8rem;">Online Players: 0</div>
         `;
        const btn = document.getElementById('btn-join-platformer');
        const start = (e) => {
            if (e && e.type === 'touchstart') e.preventDefault();
            this.joinGame();
        };
        btn.addEventListener('click', start);
        btn.addEventListener('touchstart', start);
    }

    updateHUD() {
        const hud = document.getElementById('platformer-hp');
        if (hud) {
            hud.innerText = this.me.hp;
            hud.style.color = this.me.hp > 30 ? '#0f0' : '#f00';
        }
    }

    update() {
        if (!this.playing) return;

        if (this.me.cooldown > 0) this.me.cooldown--;

        // Horizontal Movement
        if (this.keys['a']) this.me.vx -= this.MOVE_SPEED;
        if (this.keys['d']) this.me.vx += this.MOVE_SPEED;

        // Friction
        this.me.vx *= this.FRICTION;

        // Gravity
        this.me.vy += this.GRAVITY;

        // Apply Velocity
        this.me.x += this.me.vx;
        this.me.y += this.me.vy;

        // Map Floor/Platform Collision
        this.me.grounded = false;

        for (let p of this.platforms) {
            // Check landing on top only if falling down
            if (this.me.vy >= 0 &&
                this.me.y + 10 >= p.y && this.me.y + 10 <= p.y + p.h + 10 &&
                this.me.x + 10 > p.x && this.me.x - 10 < p.x + p.w) {

                this.me.y = p.y - 10;
                this.me.vy = 0;
                this.me.grounded = true;
            }
        }

        // Death zone
        if (this.me.y > this.canvas.height + 50) {
            this.takeDamage(100);
        }

        // Map Bounds (Sites)
        if (this.me.x < 0) this.me.x = 0;
        if (this.me.x > this.canvas.width) this.me.x = this.canvas.width;

        // Sync (High refresh rate)
        if (this.client && this.client.isConnected()) {
            this.publish({
                type: 'update',
                x: this.me.x, y: this.me.y,
                angle: this.me.angle,
                hp: this.me.hp,
                color: this.me.color
            });
        }
    }

    updateBullets() {
        for (let i = this.bullets.length - 1; i >= 0; i--) {
            const b = this.bullets[i];
            b.x += b.vx;
            b.y += b.vy;
            b.life--;

            if (b.life <= 0 ||
                b.x < 0 || b.x > this.canvas.width ||
                b.y < 0 || b.y > this.canvas.height) {
                this.bullets.splice(i, 1);
                continue;
            }

            // Hit detection
            if (this.playing && this.me.hp > 0 && b.owner !== this.myId) {
                const dx = b.x - this.me.x;
                const dy = b.y - this.me.y;
                if (Math.sqrt(dx * dx + dy * dy) < 15) {
                    this.takeDamage(10);
                    this.bullets.splice(i, 1);
                    continue;
                }
            }
        }
    }

    loop() {
        const now = Date.now();
        this.lastTime = now;

        this.update();
        this.updateBullets();
        this.draw();

        requestAnimationFrame(() => this.loop());
    }

    draw() {
        this.ctx.fillStyle = '#111';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        this.ctx.shadowBlur = 10;
        this.ctx.shadowColor = '#00ffff';
        this.ctx.fillStyle = '#003333';
        this.ctx.strokeStyle = '#00ffff';
        for (let p of this.platforms) {
            this.ctx.fillRect(p.x, p.y, p.w, p.h);
            this.ctx.strokeRect(p.x, p.y, p.w, p.h);
        }
        this.ctx.shadowBlur = 0;

        const now = Date.now();
        for (const id in this.others) {
            const p = this.others[id];
            if (now - p.lastSeen > 5000) { delete this.others[id]; continue; }
            this.drawPlayer(p.x, p.y, p.angle, '#00ffff', id);
        }

        if (this.playing && this.me.hp > 0) {
            this.drawPlayer(this.me.x, this.me.y, this.me.angle, '#ff00ff', 'YOU');
        }

        this.ctx.fillStyle = '#ffcc00';
        this.bullets.forEach(b => {
            this.ctx.beginPath();
            this.ctx.arc(b.x, b.y, 4, 0, Math.PI * 2);
            this.ctx.fill();
        });
    }

    drawPlayer(x, y, angle, color, label) {
        this.ctx.save();
        this.ctx.translate(x, y);

        this.ctx.fillStyle = '#fff';
        this.ctx.font = '10px monospace';
        this.ctx.textAlign = 'center';
        this.ctx.fillText(label.substr(0, 8), 0, -25);

        this.ctx.fillStyle = color;
        this.ctx.shadowBlur = 10;
        this.ctx.shadowColor = color;
        this.ctx.beginPath();
        this.ctx.rect(-10, -10, 20, 20);
        this.ctx.fill();

        this.ctx.rotate(angle);
        this.ctx.fillStyle = '#fff';
        this.ctx.fillRect(0, -2, 18, 4);

        this.ctx.restore();
    }
}

// Explicitly export to window to ensure visibility
window.PlatformerGame = PlatformerGame;
