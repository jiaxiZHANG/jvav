/**
 * shooter_game.js
 * Simple 2D Top-Down Shooter using MQTT
 */

class ShooterGame {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas.getContext('2d');

        // Config
        this.brokerUrl = "broker.emqx.io";
        this.port = 8084;
        this.topic = "jvav/shooter/update";
        this.myId = 'soldier_' + Math.floor(Math.random() * 100000);

        // State
        this.playing = false;
        this.connected = false;
        this.me = {
            x: 400, y: 200, hp: 100, color: '#ff00ff', angle: 0,
            vx: 0, vy: 0, cooldown: 0
        };
        this.others = {}; // id -> {x, y, angle, hp, color, lastSeen}
        this.bullets = []; // {x, y, vx, vy, owner}
        this.keys = {};

        // Listeners
        this.bindEvents();

        // Loop
        this.lastTime = Date.now();
        requestAnimationFrame(() => this.loop());
    }

    bindEvents() {
        // UI
        const joinBtn = document.getElementById('btn-join-shooter');
        const overlay = document.getElementById('shooter-overlay');

        console.log("ShooterGame: Binding Events", { joinBtn, overlay });

        const start = (e) => {
            console.log("ShooterGame: Join Triggered");
            if (e && e.type === 'touchstart') e.preventDefault();
            this.joinGame();
        };

        if (joinBtn) {
            joinBtn.addEventListener('click', start);
            joinBtn.addEventListener('touchstart', start);
        }

        // Also allow clicking the overlay text/background for convenience
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
        });
        window.addEventListener('keyup', (e) => {
            if (!this.playing) return;
            this.keys[e.key.toLowerCase()] = false;
        });

        this.canvas.addEventListener('mousemove', (e) => {
            if (!this.playing) return;
            const rect = this.canvas.getBoundingClientRect();
            // Scale if canvas is resized by CSS
            const scaleX = this.canvas.width / rect.width;
            const scaleY = this.canvas.height / rect.height;

            const mx = (e.clientX - rect.left) * scaleX;
            const my = (e.clientY - rect.top) * scaleY;

            this.me.angle = Math.atan2(my - this.me.y, mx - this.me.x);
        });

        this.canvas.addEventListener('mousedown', () => {
            if (this.playing && this.me.hp > 0) this.shoot();
        });
    }

    joinGame() {
        if (!this.connected) this.connectMQTT();
        document.getElementById('shooter-overlay').style.display = 'none';
        document.getElementById('shooter-hud').style.display = 'block';
        this.playing = true;
        this.respawn();
    }

    respawn() {
        this.me.hp = 100;
        this.me.x = Math.random() * (this.canvas.width - 40) + 20;
        this.me.y = Math.random() * (this.canvas.height - 40) + 20;
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
                // Spawn bullet from other player
                this.bullets.push({
                    x: data.x, y: data.y,
                    vx: Math.cos(data.angle) * 10,
                    vy: Math.sin(data.angle) * 10,
                    owner: data.id,
                    life: 60
                });
            } else if (data.type === 'hit') {
                if (data.target === this.myId) {
                    this.takeDamage(10);
                }
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

        // Local bullet
        const speed = 10;
        const vx = Math.cos(this.me.angle) * speed;
        const vy = Math.sin(this.me.angle) * speed;

        this.bullets.push({
            x: this.me.x, y: this.me.y,
            vx: vx, vy: vy,
            owner: this.myId,
            life: 60
        });

        // Network bullet
        this.publish({ type: 'shoot', x: this.me.x, y: this.me.y, angle: this.me.angle });

        this.me.cooldown = 5;
    }

    takeDamage(amount) {
        if (this.me.hp <= 0) return;
        this.me.hp -= amount;
        this.updateHUD();

        if (this.me.hp <= 0) {
            this.playing = false;
            document.getElementById('shooter-overlay').style.display = 'flex';
            document.getElementById('shooter-overlay').innerHTML = `
                <h3 style="color:red">YOU DIED</h3>
                <button id="btn-respawn" style="margin-top:20px; padding:10px;">RESPAWN</button>
            `;
            document.getElementById('btn-respawn').addEventListener('click', () => {
                document.getElementById('shooter-overlay').innerHTML = ''; // reset content logic later... simple reload or hack
                // Just clear innerHTML usually works but buttons gone.
                // Let's restore overlay content
                this.restoreOverlay();
                this.joinGame();
            });
        }
    }

    restoreOverlay() {
        document.getElementById('shooter-overlay').innerHTML = `
             <h3 style="color: #ff00ff; font-family: 'Share Tech Mono'; font-size: 2rem; margin: 0;">NEON BATTLE</h3>
             <p style="color: #fff; margin: 10px 0;">WASD to Move | Mouse to Aim & Shoot</p>
             <button id="btn-join-shooter" style="padding: 10px 30px; font-size: 1.2rem; background: #ff00ff; color: #fff; border: none; font-family: 'Share Tech Mono'; cursor: pointer; margin-top: 10px;">JOIN GAME</button>
             <div id="shooter-status" style="color: #ccc; margin-top: 10px; font-size: 0.8rem;">Online Players: 0</div>
         `;
        document.getElementById('btn-join-shooter').addEventListener('click', () => this.joinGame());
    }

    updateHUD() {
        const hud = document.getElementById('shooter-hp');
        if (hud) {
            hud.innerText = this.me.hp;
            hud.style.color = this.me.hp > 30 ? '#0f0' : '#f00';
        }
    }

    update(dt) {
        if (!this.playing) return;

        // Cooldown
        if (this.me.cooldown > 0) this.me.cooldown--;

        // Movement
        const speed = 3;
        if (this.keys['w']) this.me.y -= speed;
        if (this.keys['s']) this.me.y += speed;
        if (this.keys['a']) this.me.x -= speed;
        if (this.keys['d']) this.me.x += speed;

        // Bounds
        this.me.x = Math.max(10, Math.min(this.canvas.width - 10, this.me.x));
        this.me.y = Math.max(10, Math.min(this.canvas.height - 10, this.me.y));

        // Sync (Throttle: every 3 frames (~20fps))
        if (this.client && this.client.isConnected() && Math.random() < 0.3) {
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

            // Collision detection (Bullet hits ME)
            if (this.playing && this.me.hp > 0 && b.owner !== this.myId) {
                const dx = b.x - this.me.x;
                const dy = b.y - this.me.y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist < 15) { // Hitbox radius
                    this.takeDamage(10);
                    this.bullets.splice(i, 1);
                    // Notify shooter they hit me (optional, good for kill feed)
                    continue;
                }
            }
        }
    }

    loop() {
        const now = Date.now();
        // const dt = (now - this.lastTime) / 1000;
        this.lastTime = now;

        this.update();
        this.updateBullets();
        this.draw();

        requestAnimationFrame(() => this.loop());
    }

    draw() {
        // Clear
        this.ctx.fillStyle = '#111';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        // Grid (Cyberpunk style)
        this.ctx.strokeStyle = '#222';
        this.ctx.lineWidth = 1;
        for (let x = 0; x < this.canvas.width; x += 50) {
            this.ctx.beginPath(); this.ctx.moveTo(x, 0); this.ctx.lineTo(x, this.canvas.height); this.ctx.stroke();
        }
        for (let y = 0; y < this.canvas.height; y += 50) {
            this.ctx.beginPath(); this.ctx.moveTo(0, y); this.ctx.lineTo(this.canvas.width, y); this.ctx.stroke();
        }

        // Draw Others
        const now = Date.now();
        for (const id in this.others) {
            const parsedId = String(id).replace(/^\d+/, ''); // Remove leading numbers if Paho adds them?? No, safe.
            const p = this.others[id];
            if (now - p.lastSeen > 5000) { delete this.others[id]; continue; } // Timeout

            this.drawPlayer(p.x, p.y, p.angle, '#00ffff', id); // Others are Cyan
        }

        // Draw Me
        if (this.playing && this.me.hp > 0) {
            this.drawPlayer(this.me.x, this.me.y, this.me.angle, '#ff00ff', 'YOU');
        }

        // Draw Bullets
        this.ctx.fillStyle = '#ffcc00';
        this.bullets.forEach(b => {
            this.ctx.beginPath();
            this.ctx.arc(b.x, b.y, 3, 0, Math.PI * 2);
            this.ctx.fill();
        });
    }

    drawPlayer(x, y, angle, color, label) {
        this.ctx.save();
        this.ctx.translate(x, y);

        // Label
        this.ctx.fillStyle = '#fff';
        this.ctx.font = '10px monospace';
        this.ctx.textAlign = 'center';
        this.ctx.fillText(label.substr(0, 8), 0, -25);

        // Rotate body
        this.ctx.rotate(angle);

        // Body
        this.ctx.fillStyle = color;
        this.ctx.shadowBlur = 10;
        this.ctx.shadowColor = color;
        this.ctx.beginPath();
        if (this.connected) {
            const msg = new Paho.MQTT.Message(JSON.stringify({ ...data, id: this.myId }));
            msg.destinationName = this.topic;
            this.client.send(msg);
        }
    }

    shoot() {
        if (this.me.cooldown > 0) return;

        // Local bullet
        const speed = 10;
        const vx = Math.cos(this.me.angle) * speed;
        const vy = Math.sin(this.me.angle) * speed;

        this.bullets.push({
            x: this.me.x, y: this.me.y,
            vx: vx, vy: vy,
            owner: this.myId,
            life: 60
        });

        // Network bullet
        this.publish({ type: 'shoot', x: this.me.x, y: this.me.y, angle: this.me.angle });

        this.me.cooldown = 10;
    }

    takeDamage(amount) {
        if (this.me.hp <= 0) return;
        this.me.hp -= amount;
        this.updateHUD();

        if (this.me.hp <= 0) {
            this.playing = false;
            document.getElementById('shooter-overlay').style.display = 'flex';
            document.getElementById('shooter-overlay').innerHTML = `
                <h3 style="color:red">YOU DIED</h3>
                <button id="btn-respawn" style="margin-top:20px; padding:10px;">RESPAWN</button>
            `;
            document.getElementById('btn-respawn').addEventListener('click', () => {
                document.getElementById('shooter-overlay').innerHTML = ''; // reset content logic later... simple reload or hack
                // Just clear innerHTML usually works but buttons gone.
                // Let's restore overlay content
                this.restoreOverlay();
                this.joinGame();
            });
        }
    }

    restoreOverlay() {
        document.getElementById('shooter-overlay').innerHTML = `
             <h3 style="color: #ff00ff; font-family: 'Share Tech Mono'; font-size: 2rem; margin: 0;">NEON BATTLE</h3>
             <p style="color: #fff; margin: 10px 0;">WASD to Move | Mouse to Aim & Shoot</p>
             <button id="btn-join-shooter" style="padding: 10px 30px; font-size: 1.2rem; background: #ff00ff; color: #fff; border: none; font-family: 'Share Tech Mono'; cursor: pointer; margin-top: 10px;">JOIN GAME</button>
             <div id="shooter-status" style="color: #ccc; margin-top: 10px; font-size: 0.8rem;">Online Players: 0</div>
         `;
        document.getElementById('btn-join-shooter').addEventListener('click', () => this.joinGame());
    }

    updateHUD() {
        const hud = document.getElementById('shooter-hp');
        if (hud) {
            hud.innerText = this.me.hp;
            hud.style.color = this.me.hp > 30 ? '#0f0' : '#f00';
        }
    }

    update(dt) {
        if (!this.playing) return;

        // Cooldown
        if (this.me.cooldown > 0) this.me.cooldown--;

        // Movement
        const speed = 3;
        if (this.keys['w']) this.me.y -= speed;
        if (this.keys['s']) this.me.y += speed;
        if (this.keys['a']) this.me.x -= speed;
        if (this.keys['d']) this.me.x += speed;

        // Bounds
        this.me.x = Math.max(10, Math.min(this.canvas.width - 10, this.me.x));
        this.me.y = Math.max(10, Math.min(this.canvas.height - 10, this.me.y));

        // Sync (Throttle: every 3 frames (~20fps))
        if (this.client && this.client.isConnected() && Math.random() < 0.3) {
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

            // Collision detection (Bullet hits ME)
            if (this.playing && this.me.hp > 0 && b.owner !== this.myId) {
                const dx = b.x - this.me.x;
                const dy = b.y - this.me.y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist < 15) { // Hitbox radius
                    this.takeDamage(10);
                    this.bullets.splice(i, 1);
                    // Notify shooter they hit me (optional, good for kill feed)
                    continue;
                }
            }
        }
    }

    loop() {
        const now = Date.now();
        // const dt = (now - this.lastTime) / 1000;
        this.lastTime = now;

        this.update();
        this.updateBullets();
        this.draw();

        requestAnimationFrame(() => this.loop());
    }

    draw() {
        // Clear
        this.ctx.fillStyle = '#111';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        // Grid (Cyberpunk style)
        this.ctx.strokeStyle = '#222';
        this.ctx.lineWidth = 1;
        for (let x = 0; x < this.canvas.width; x += 50) {
            this.ctx.beginPath(); this.ctx.moveTo(x, 0); this.ctx.lineTo(x, this.canvas.height); this.ctx.stroke();
        }
        for (let y = 0; y < this.canvas.height; y += 50) {
            this.ctx.beginPath(); this.ctx.moveTo(0, y); this.ctx.lineTo(this.canvas.width, y); this.ctx.stroke();
        }

        // Draw Others
        const now = Date.now();
        for (const id in this.others) {
            const parsedId = String(id).replace(/^\d+/, ''); // Remove leading numbers if Paho adds them?? No, safe.
            const p = this.others[id];
            if (now - p.lastSeen > 5000) { delete this.others[id]; continue; } // Timeout

            this.drawPlayer(p.x, p.y, p.angle, '#00ffff', id); // Others are Cyan
        }

        // Draw Me
        if (this.playing && this.me.hp > 0) {
            this.drawPlayer(this.me.x, this.me.y, this.me.angle, '#ff00ff', 'YOU');
        }

        // Draw Bullets
        this.ctx.fillStyle = '#ffcc00';
        this.bullets.forEach(b => {
            this.ctx.beginPath();
            this.ctx.arc(b.x, b.y, 3, 0, Math.PI * 2);
            this.ctx.fill();
        });
    }

    drawPlayer(x, y, angle, color, label) {
        this.ctx.save();
        this.ctx.translate(x, y);

        // Label
        this.ctx.fillStyle = '#fff';
        this.ctx.font = '10px monospace';
        this.ctx.textAlign = 'center';
        this.ctx.fillText(label.substr(0, 8), 0, -25);

        // Rotate body
        this.ctx.rotate(angle);

        // Body
        this.ctx.fillStyle = color;
        this.ctx.shadowBlur = 10;
        this.ctx.shadowColor = color;
        this.ctx.beginPath();
        this.ctx.rect(-10, -10, 20, 20);
        this.ctx.fill();
        this.ctx.shadowBlur = 0;

        // Gun
        this.ctx.fillStyle = '#333';
        this.ctx.fillRect(10, -4, 15, 8); // Gun barrel

        this.ctx.restore();
    }
}

// Explicitly export to window to ensure visibility
window.ShooterGame = ShooterGame;
