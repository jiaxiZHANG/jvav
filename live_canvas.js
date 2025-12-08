/**
 * live_canvas.js
 * Multi-user interaction using MQTT over WebSockets.
 * No database required. Uses public broker: broker.emqx.io
 */

class LiveCanvas {
    constructor(containerId) {
        this.container = document.getElementById(containerId);
        this.canvas = document.createElement('canvas');
        this.ctx = this.canvas.getContext('2d');
        this.container.appendChild(this.canvas);

        // User Identity
        this.myId = 'user_' + Math.floor(Math.random() * 100000);
        this.myColor = `hsl(${Math.random() * 360}, 100%, 70%)`; // Bright neon colors

        // State
        this.users = {}; // { id: {x, y, color, lastSeen} }
        this.isDrawing = false;
        this.clientId = "jvav_client_" + Math.random().toString(16).substr(2, 8);

        // MQTT Configuration
        this.brokerUrl = "broker.emqx.io";
        this.port = 8084; // SSL PORT (Required for GitHub Pages)
        this.topic = "jvav/live/interaction";

        this.initCanvas();
        // this.initMQTT(); // Deferred to user action
        this.animate();

        // Resize Listener
        window.addEventListener('resize', () => this.resize());
    }

    initCanvas() {
        this.resize();
        this.canvas.style.cursor = 'crosshair';
        this.canvas.style.background = 'rgba(0, 0, 0, 0.1)'; // Semi-transparent
        this.canvas.style.border = '1px solid #00ffff44';
        this.canvas.style.borderRadius = '4px';
        this.canvas.style.touchAction = 'none'; // CRITICAL: Stop mobile scrolling

        // Event Listeners
        this.canvas.addEventListener('mousemove', (e) => this.onMove(e));
        this.canvas.addEventListener('mousedown', (e) => this.onDown(e));
        this.canvas.addEventListener('mouseup', () => this.onUp());
        this.canvas.addEventListener('mouseout', () => this.onUp());

        // Touch support - Enhanced
        this.canvas.addEventListener('touchmove', (e) => {
            e.preventDefault();
            if (e.touches.length > 0) this.onMove(e.touches[0]);
        }, { passive: false });
        this.canvas.addEventListener('touchstart', (e) => {
            e.preventDefault();
            if (e.touches.length > 0) this.onDown(e.touches[0]);
        }, { passive: false });
        this.canvas.addEventListener('touchend', (e) => {
            e.preventDefault();
            this.onUp();
        });

        this.createOverlay();
    }

    createOverlay() {
        this.overlay = document.createElement('div');
        this.overlay.style.position = 'absolute';
        this.overlay.style.top = '0';
        this.overlay.style.left = '0';
        this.overlay.style.width = '100%';
        this.overlay.style.height = '100%';
        this.overlay.style.display = 'flex';
        this.overlay.style.justifyContent = 'center';
        this.overlay.style.alignItems = 'center';
        this.overlay.style.background = 'rgba(0, 0, 0, 0.6)';
        this.overlay.style.zIndex = '10';
        this.overlay.style.cursor = 'pointer';

        const btn = document.createElement('button');
        btn.innerText = '点击加入互动 / Click to Connect';
        btn.style.padding = '10px 20px';
        btn.style.background = '#00ffff';
        btn.style.color = '#000';
        btn.style.border = 'none';
        btn.style.fontFamily = 'Share Tech Mono, monospace';
        btn.style.fontSize = '1.2rem';
        btn.style.cursor = 'pointer';
        btn.style.boxShadow = '0 0 10px #00ffff';
        btn.style.pointerEvents = 'none'; // Let click pass to overlay

        this.overlay.appendChild(btn);
        this.container.appendChild(this.overlay);

        const start = () => {
            this.overlay.remove();
            this.initMQTT(); // Connect now
        };

        this.overlay.addEventListener('click', start);
    }

    resize() {
        this.canvas.width = this.container.clientWidth;
        this.canvas.height = 300; // Fixed height for the playground
    }

    initMQTT() {
        // Paho is global
        if (typeof Paho === 'undefined') {
            console.error("Paho MQTT client not loaded");
            return;
        }

        this.client = new Paho.MQTT.Client(this.brokerUrl, this.port, this.clientId);

        this.client.onConnectionLost = (responseObject) => {
            console.log("MQTT Connection Lost: " + responseObject.errorMessage);
        };

        this.client.onMessageArrived = (message) => {
            try {
                const data = JSON.parse(message.payloadString);
                if (data.id === this.myId) return; // Ignore self

                this.handleRemoteData(data);
            } catch (e) {
                console.error("MQTT Parse Error", e);
            }
        };

        this.client.connect({
            onSuccess: () => {
                console.log("MQTT Connected");
                this.client.subscribe(this.topic);
            },
            onFailure: (e) => {
                console.log("MQTT Connection Failed", e);
            },
            useSSL: true
        });
    }

    publish(data) {
        if (!this.client || !this.client.isConnected()) return;
        const message = new Paho.MQTT.Message(JSON.stringify({ ...data, id: this.myId, color: this.myColor }));
        message.destinationName = this.topic;
        this.client.send(message);
    }

    getPos(e) {
        const rect = this.canvas.getBoundingClientRect();
        return {
            x: (e.clientX - rect.left) / this.canvas.width,
            y: (e.clientY - rect.top) / this.canvas.height
        };
    }

    onMove(e) {
        const pos = this.getPos(e);
        const data = { type: 'move', x: pos.x, y: pos.y };

        if (this.isDrawing) {
            data.type = 'draw';
            // Draw locally immediately for zero latency
            this.drawStroke(this.lastPos, pos, this.myColor);
            this.lastPos = pos;
        }

        this.publish(data);
    }

    onDown(e) {
        this.isDrawing = true;
        this.lastPos = this.getPos(e);
    }

    onUp() {
        this.isDrawing = false;
    }

    handleRemoteData(data) {
        const user = this.users[data.id] || {};

        if (data.type === 'move') {
            user.x = data.x;
            user.y = data.y;
            user.color = data.color;
            user.lastSeen = Date.now();
        } else if (data.type === 'draw') {
            if (user.x !== undefined) {
                this.drawStroke({ x: user.x, y: user.y }, { x: data.x, y: data.y }, data.color);
            }
            // Also update position
            user.x = data.x;
            user.y = data.y;
            user.color = data.color;
            user.lastSeen = Date.now();
        }

        this.users[data.id] = user;
    }

    drawStroke(start, end, color) {
        this.ctx.beginPath();
        this.ctx.moveTo(start.x * this.canvas.width, start.y * this.canvas.height);
        this.ctx.lineTo(end.x * this.canvas.width, end.y * this.canvas.height);
        this.ctx.strokeStyle = color;
        this.ctx.lineWidth = 2;
        this.ctx.stroke();
    }

    animate() {
        requestAnimationFrame(() => this.animate());

        // Fade effect for trails/drawing
        this.ctx.fillStyle = 'rgba(0, 0, 0, 0.05)'; // Slow fade
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        // Draw Cursors
        const now = Date.now();
        for (const [id, user] of Object.entries(this.users)) {
            // Remove inactive users
            if (now - user.lastSeen > 10000) {
                delete this.users[id];
                continue;
            }

            if (user.x !== undefined) {
                this.ctx.beginPath();
                this.ctx.fillStyle = user.color;
                this.ctx.arc(user.x * this.canvas.width, user.y * this.canvas.height, 3, 0, Math.PI * 2);
                this.ctx.fill();

                // Name tag
                this.ctx.fillStyle = '#fff';
                this.ctx.font = '10px monospace';
                this.ctx.fillText(id.substr(0, 6), user.x * this.canvas.width + 5, user.y * this.canvas.height - 5);
            }
        }
    }
}
