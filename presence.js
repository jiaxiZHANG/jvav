/**
 * presence.js
 * Real-time Online User Counter
 * Uses MQTT heartbeat mechanism
 */

class PresenceSystem {
    constructor() {
        this.topic = 'jvav/global/presence';
        this.myId = 'U' + Math.floor(Math.random() * 1000000);
        this.peers = {};
        this.count = 1; // Start with self

        // Ensure MQTT lib is loaded
        if (typeof mqtt === 'undefined') {
            console.warn('Presence: MQTT lib not loaded yet. Retrying...');
            setTimeout(() => new PresenceSystem(), 1000);
            return;
        }

        // MQTT Connection
        const options = {
            clean: true,
            connectTimeout: 4000,
            clientId: 'jvav_presence_' + this.myId,
            path: '/mqtt'
        };
        // Use global broker
        this.client = mqtt.connect('wss://broker.emqx.io:8084/mqtt', options);

        this.client.on('connect', () => {
            console.log('Presence System Online');
            this.client.subscribe(this.topic);

            // Send immediate heartbeat
            this.publishHeartbeat();

            // Loop: Send heartbeat every 5s
            setInterval(() => this.publishHeartbeat(), 5000);
        });

        this.client.on('message', (topic, msg) => {
            if (topic === this.topic) {
                try {
                    const data = JSON.parse(msg.toString());
                    // Ignore self
                    if (data.id === this.myId) return;

                    // Allow other scripts to detect network latency? (Optional)

                    // Record peer last seen
                    this.peers[data.id] = Date.now();
                } catch (e) { }
            }
        });

        // Loop: Prune old peers and update UI every 1s
        setInterval(() => this.updateCount(), 1000);
    }

    publishHeartbeat() {
        if (this.client.connected) {
            this.client.publish(this.topic, JSON.stringify({ id: this.myId }));
        }
    }

    updateCount() {
        const now = Date.now();
        let active = 1; // Count self

        for (const id in this.peers) {
            // Prune if silent for > 10s
            if (now - this.peers[id] < 10000) {
                active++;
            } else {
                delete this.peers[id];
            }
        }

        this.count = active;
        this.updateUI();
    }

    updateUI() {
        const el = document.getElementById('online-count-value');
        const dot = document.getElementById('online-indicator');

        if (el) {
            el.innerText = this.count;
            // Visual flair: flash green on update?
        }

        if (dot) {
            dot.style.boxShadow = `0 0 ${this.count * 2}px #00ff00`; // Glow intensity based on count
        }
    }
}

// Auto-start when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => new PresenceSystem());
} else {
    new PresenceSystem();
}
