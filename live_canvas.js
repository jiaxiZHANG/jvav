/**
 * live_canvas.js
 * Multi-user interaction using MQTT over WebSockets.
 * Features: Live Drawing + Real-time Danmaku
 * No database required. Uses public broker: broker.emqx.io
 */

class LiveCanvas {
    constructor(containerId) {
        this.container = document.getElementById(containerId);

        // --- CANVAS SETUP ---
        if (this.container) {
            this.container.innerHTML = '';
            this.canvas = document.createElement('canvas');
            this.ctx = this.canvas.getContext('2d');
            this.container.appendChild(this.canvas);
        }

        // --- DANMAKU SETUP ---
        this.danmakuStage = document.getElementById('danmaku-stage');
        this.danmakuInput = document.getElementById('danmaku-input');
        this.danmakuBtn = document.getElementById('btn-send-danmaku');

        // State for limits
        this.lastDanmakuTime = 0;
        this.DANMAKU_COOLDOWN = 30000; // 30 seconds

        if (this.danmakuBtn && this.danmakuInput) {
            this.danmakuBtn.addEventListener('click', () => this.sendDanmaku());
            this.danmakuInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') this.sendDanmaku();
            });
        }

        // --- COMMON SETUP ---
        this.myId = 'user_' + Math.floor(Math.random() * 100000);
        this.myColor = `hsl(${Math.random() * 360}, 100%, 70%)`;
        this.users = {};
        this.isDrawing = false;
        this.clientId = "jvav_client_" + Math.random().toString(16).substr(2, 8);
        this.connected = false;

        this.brokerUrl = "broker.emqx.io";
        this.port = 8084; // SSL
        this.topic = "jvav/live/interaction";

        if (this.container) this.initCanvas();
        // this.initMQTT(); // Delayed
        this.animate();

        window.addEventListener('resize', () => {
            if (this.container) this.resize();
        });
    }

    // --- CANVAS METHODS ---
    initCanvas() {
        this.resize();
        this.canvas.style.cursor = 'crosshair';
        this.canvas.style.background = 'rgba(0, 0, 0, 0.1)';
        this.canvas.style.border = '1px solid #00ffff44';
        this.canvas.style.borderRadius = '4px';
        this.canvas.style.touchAction = 'none';

        this.canvas.addEventListener('mousemove', (e) => this.onMove(e));
        this.canvas.addEventListener('mousedown', (e) => this.onDown(e));
        this.canvas.addEventListener('mouseup', () => this.onUp());
        this.canvas.addEventListener('mouseout', () => this.onUp());

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
        btn.innerText = '点击加入互动 (画板 & 弹幕)';
        btn.style.padding = '10px 20px';
        btn.style.background = '#00ffff';
        btn.style.color = '#000';
        btn.style.border = 'none';
        btn.style.fontFamily = 'Share Tech Mono, monospace';
        btn.style.fontSize = '1.2rem';
        btn.style.cursor = 'pointer';
        btn.style.pointerEvents = 'auto';

        this.overlay.appendChild(btn);
        this.container.appendChild(this.overlay);

        const start = (e) => {
            if (e) { e.preventDefault(); e.stopPropagation(); }
            if (this.overlay.parentNode) {
                this.overlay.remove();
                this.initMQTT();
            }
        };

        this.overlay.addEventListener('click', start);
        btn.addEventListener('click', start);
        btn.addEventListener('touchstart', start);
    }

    resize() {
        this.canvas.width = this.container.clientWidth;
        this.canvas.height = 300;
    }

    // --- DANMAKU METHODS ---
    sendDanmaku() {
        if (!this.connected) {
            alert("请先点击画板上的'加入互动'按钮连接服务器！");
            return;
        }

        // COOLDOWN CHECK
        const now = Date.now();
        if (now - this.lastDanmakuTime < this.DANMAKU_COOLDOWN) {
            const remaining = Math.ceil((this.DANMAKU_COOLDOWN - (now - this.lastDanmakuTime)) / 1000);
            alert(`发送太快了！请休息 ${remaining} 秒再发。`);
            return;
        }

        const text = this.danmakuInput.value.trim();
        if (!text) return;

        // Double check length (HTML attribute should prevent this but just in case)
        if (text.length > 30) {
            alert("弹幕太长了！(Max 30)");
            return;
        }

        // Basic filter
        if (text.includes('<') || text.includes('script')) {
            alert("仅限纯文本！");
            return;
        }

        this.publish({ type: 'danmaku', text: text });
        this.danmakuInput.value = '';
        this.lastDanmakuTime = now; // Update cooldown

        // Local render immediately (optional, but good for feedback)
        this.renderDanmaku(text, this.myColor, true);
    }

    renderDanmaku(text, color, isSelf = false) {
        if (!this.danmakuStage) return;

        const el = document.createElement('div');
        el.innerText = text;
        el.style.position = 'absolute';
        el.style.whiteSpace = 'nowrap';
        el.style.color = color;
        el.style.fontWeight = 'bold';
        el.style.fontFamily = "Share Tech Mono, monospace";
        el.style.fontSize = '20px';
        el.style.textShadow = '0 0 5px #000';
        el.style.willChange = 'transform';
        if (isSelf) el.style.border = '1px solid #00ffff44'; // Highlight self

        // Track & Position
        const trackHeight = 30; // height per track
        const tracks = Math.floor(this.danmakuStage.clientHeight / trackHeight);
        const track = Math.floor(Math.random() * tracks);
        el.style.top = (track * trackHeight) + 'px';
        el.style.left = '100%';

        this.danmakuStage.appendChild(el);

        // Animate
        const duration = 5000 + Math.random() * 3000; // 5-8s duration

        requestAnimationFrame(() => {
            el.style.transition = `transform ${duration}ms linear`;
            el.style.transform = `translateX(-${this.danmakuStage.clientWidth + 200}px)`;
        });

        // Cleanup
        setTimeout(() => {
            if (el.parentNode) el.remove();
        }, duration + 100);
    }

    // --- MQTT & LOGIC ---
    initMQTT() {
        if (typeof Paho === 'undefined') {
            console.error("Paho Not Loaded");
            return;
        }
        this.client = new Paho.MQTT.Client(this.brokerUrl, this.port, this.clientId);
        this.client.onConnectionLost = () => { this.connected = false; };
        this.client.onMessageArrived = (msg) => {
            try {
                const data = JSON.parse(msg.payloadString);
                if (data.id === this.myId) return;
                this.handleRemoteData(data);
            } catch (e) { }
        };
        this.client.connect({
            onSuccess: () => {
                this.connected = true;
                this.client.subscribe(this.topic);
            },
            onFailure: (e) => { console.log("Conn Fail", e); },
            useSSL: true
        });
    }

    publish(data) {
        if (!this.client || !this.client.isConnected()) return;
        const msg = new Paho.MQTT.Message(JSON.stringify({ ...data, id: this.myId, color: this.myColor }));
        msg.destinationName = this.topic;
        this.client.send(msg);
    }

    handleRemoteData(data) {
        if (data.type === 'danmaku') {
            this.renderDanmaku(data.text, data.color);
            return;
        }

        const user = this.users[data.id] || {};
        if (data.type === 'move') {
            user.x = data.x; user.y = data.y; user.color = data.color;
            user.lastSeen = Date.now();
        } else if (data.type === 'draw') {
            if (user.x !== undefined) this.drawStroke({ x: user.x, y: user.y }, { x: data.x, y: data.y }, data.color);
            user.x = data.x; user.y = data.y; user.color = data.color;
            user.lastSeen = Date.now();
        }
        this.users[data.id] = user;
    }

    // --- HELPERS ---
    getPos(e) {
        const rect = this.canvas.getBoundingClientRect();
        return { x: (e.clientX - rect.left) / this.canvas.width, y: (e.clientY - rect.top) / this.canvas.height };
    }
    onMove(e) {
        if (!this.container) return;
        const pos = this.getPos(e);
        const data = { type: 'move', x: pos.x, y: pos.y };
        if (this.isDrawing) {
            data.type = 'draw';
            this.drawStroke(this.lastPos, pos, this.myColor);
            this.lastPos = pos;
        }
        this.publish(data);
    }
    onDown(e) {
        this.isDrawing = true;
        this.lastPos = this.getPos(e);
        this.publish({ type: 'move', x: this.lastPos.x, y: this.lastPos.y });
    }
    onUp() { this.isDrawing = false; }

    drawStroke(s, e, c) {
        this.ctx.beginPath();
        this.ctx.moveTo(s.x * this.canvas.width, s.y * this.canvas.height);
        this.ctx.lineTo(e.x * this.canvas.width, e.y * this.canvas.height);
        this.ctx.strokeStyle = c;
        this.ctx.lineWidth = 2;
        this.ctx.stroke();
    }

    drawStatus() {
        this.ctx.font = '12px monospace';
        if (this.connected) {
            this.ctx.fillStyle = '#00ff00';
            this.ctx.fillText('● LIVE', this.canvas.width - 50, 20);
        } else {
            this.ctx.fillStyle = '#ff0000';
            this.ctx.fillText('○ WAIT', this.canvas.width - 50, 20);
        }
    }

    animate() {
        requestAnimationFrame(() => this.animate());
        if (this.canvas) {
            this.ctx.fillStyle = 'rgba(0, 0, 0, 0.05)';
            this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
            this.drawStatus();
            const now = Date.now();
            for (const [id, user] of Object.entries(this.users)) {
                if (now - user.lastSeen > 10000) { delete this.users[id]; continue; }
                if (user.x !== undefined) {
                    this.ctx.beginPath();
                    this.ctx.fillStyle = user.color;
                    this.ctx.arc(user.x * this.canvas.width, user.y * this.canvas.height, 3, 0, Math.PI * 2);
                    this.ctx.fill();
                    this.ctx.fillStyle = '#fff';
                    this.ctx.font = '10px monospace';
                    this.ctx.fillText(id.substr(0, 6), user.x * this.canvas.width + 5, user.y * this.canvas.height - 5);
                }
            }
        }
    }
}
