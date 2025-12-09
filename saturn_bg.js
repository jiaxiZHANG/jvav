/**
 * SaturnBackground.js
 * A standalone, dependency-free (except Three.js) Saturn particle system.
 * 
 * Usage:
 * 1. Include Three.js and PostProcessing scripts.
 * 2. Include this script.
 * 3. new SaturnBackground('your-container-id');
 */

const saturnConfig = {
    particleCount: 100000, // More particles for richer effect
    saturnRadius: 25, // Bigger core
    ringInnerRadius: 30,
    ringOuterRadius: 70,
    cameraZ: 60, // Closer camera = bigger Saturn
    bloomStrength: 2.5,
    bloomRadius: 0.8,
    bloomThreshold: 0.2,
};

const bgVertexShader = `
uniform float time;
attribute float size;
attribute float orbitSpeed;
attribute float orbitRadius;
attribute float orbitAngleOffset;
attribute vec3 customColor;
attribute float isRing;

varying vec3 vColor;
varying float vAlpha;

void main() {
    float currentSpeed = orbitSpeed;
    float angle = orbitAngleOffset + currentSpeed * time * 0.05;

    vec3 newPos = position;
    
    if (isRing > 0.5) {
        newPos.x = cos(angle) * orbitRadius;
        newPos.z = sin(angle) * orbitRadius;
    } else {
        float c = cos(angle * 0.5); 
        float s = sin(angle * 0.5);
        float x = newPos.x * c - newPos.z * s;
        float z = newPos.x * s + newPos.z * c;
        newPos.x = x;
        newPos.z = z;
    }

    // Default static scale (slightly expanded for aesthetics)
    float scaleFactor = 1.0; 
    newPos *= scaleFactor;

    vec4 mvPosition = modelViewMatrix * vec4(newPos, 1.0);
    gl_Position = projectionMatrix * mvPosition;

    gl_PointSize = size * (300.0 / -mvPosition.z);

    // Subtle breathing brightness
    float brightness = 0.8 + 0.2 * sin(time * 0.5);
    vColor = customColor * brightness;
    vAlpha = 1.0;
}
`;

const bgFragmentShader = `
uniform sampler2D pointTexture;
varying vec3 vColor;
varying float vAlpha;

void main() {
    vec2 coord = gl_PointCoord - vec2(0.5);
    if(length(coord) > 0.5) discard;

    float strength = 1.0 - (length(coord) * 2.0);
    strength = pow(strength, 1.5);

    gl_FragColor = vec4(vColor, vAlpha * strength);
}
`;

class SaturnBackground {
    constructor(containerId) {
        this.container = document.getElementById(containerId);
        if (!this.container) {
            console.error(`SaturnBackground: Container '#${containerId}' not found.`);
            return;
        }

        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.composer = null;
        this.material = null;
        this.geometry = null;
        this.particles = null;
        this.time = 0;

        this.initThree();
        this.initParticles();
        this.initPostProcessing();
        this.addListeners();
        this.animate();
    }

    initThree() {
        this.scene = new THREE.Scene();
        this.scene.fog = new THREE.FogExp2(0x000000, 0.002);

        const width = this.container.clientWidth;
        const height = this.container.clientHeight;

        this.camera = new THREE.PerspectiveCamera(75, width / height, 0.1, 1000);
        this.camera.position.z = saturnConfig.cameraZ;
        this.camera.position.y = 20;
        this.camera.lookAt(0, 0, 0);

        this.renderer = new THREE.WebGLRenderer({
            antialias: false,
            powerPreference: "high-performance",
            alpha: true
        });
        this.renderer.setSize(width, height);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.container.appendChild(this.renderer.domElement);
    }

    initParticles() {
        this.geometry = new THREE.BufferGeometry();

        const positions = [];
        const colors = [];
        const sizes = [];
        const orbitSpeeds = [];
        const orbitRadii = [];
        const orbitAngleOffsets = [];
        const isRings = [];

        const colorCore = new THREE.Color(0xffaa33);
        const colorRingInner = new THREE.Color(0xccaa88);
        const colorRingOuter = new THREE.Color(0x6688aa);

        for (let i = 0; i < saturnConfig.particleCount; i++) {
            let x, y, z, r, g, b, size, speed, radius, angle, isRingVal;

            if (Math.random() < 0.3) {
                const theta = Math.random() * Math.PI * 2;
                const phi = Math.acos(2 * Math.random() - 1);
                const r_sphere = saturnConfig.saturnRadius * Math.cbrt(Math.random());

                x = r_sphere * Math.sin(phi) * Math.cos(theta);
                y = r_sphere * Math.sin(phi) * Math.sin(theta);
                z = r_sphere * Math.cos(phi);

                r = colorCore.r; g = colorCore.g; b = colorCore.b;
                size = Math.random() * 0.8 + 0.2;
                speed = 0.5; radius = 0; angle = 0; isRingVal = 0.0;
            } else {
                const minR = saturnConfig.ringInnerRadius;
                const maxR = saturnConfig.ringOuterRadius;
                radius = minR + Math.random() * (maxR - minR);
                angle = Math.random() * Math.PI * 2;
                y = (Math.random() - 0.5) * 1.5;
                x = Math.cos(angle) * radius;
                z = Math.sin(angle) * radius;

                const t = (radius - minR) / (maxR - minR);
                const col = new THREE.Color().lerpColors(colorRingInner, colorRingOuter, t);
                r = col.r; g = col.g; b = col.b;
                size = Math.random() * 0.6 + 0.1;
                speed = 50.0 / Math.sqrt(radius);
                isRingVal = 1.0;
            }

            positions.push(x, y, z);
            colors.push(r, g, b);
            sizes.push(size);
            orbitSpeeds.push(speed);
            orbitRadii.push(radius);
            orbitAngleOffsets.push(angle);
            isRings.push(isRingVal);
        }

        this.geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        this.geometry.setAttribute('customColor', new THREE.Float32BufferAttribute(colors, 3));
        this.geometry.setAttribute('size', new THREE.Float32BufferAttribute(sizes, 1));
        this.geometry.setAttribute('orbitSpeed', new THREE.Float32BufferAttribute(orbitSpeeds, 1));
        this.geometry.setAttribute('orbitRadius', new THREE.Float32BufferAttribute(orbitRadii, 1));
        this.geometry.setAttribute('orbitAngleOffset', new THREE.Float32BufferAttribute(orbitAngleOffsets, 1));
        this.geometry.setAttribute('isRing', new THREE.Float32BufferAttribute(isRings, 1));

        this.material = new THREE.ShaderMaterial({
            uniforms: {
                time: { value: 0 }
            },
            vertexShader: bgVertexShader,
            fragmentShader: bgFragmentShader,
            blending: THREE.AdditiveBlending,
            depthTest: false,
            transparent: true
        });

        this.particles = new THREE.Points(this.geometry, this.material);
        this.particles.rotation.z = 27 * (Math.PI / 180);
        this.particles.rotation.x = 10 * (Math.PI / 180);
        this.scene.add(this.particles);
    }

    initPostProcessing() {
        if (typeof THREE.EffectComposer === 'undefined') {
            console.warn("THREE.EffectComposer not found. Bloom disabled.");
            return;
        }

        const renderScene = new THREE.RenderPass(this.scene, this.camera);
        const bloomPass = new THREE.UnrealBloomPass(
            new THREE.Vector2(this.container.clientWidth, this.container.clientHeight),
            1.5, 0.4, 0.85
        );
        bloomPass.threshold = saturnConfig.bloomThreshold;
        bloomPass.strength = saturnConfig.bloomStrength;
        bloomPass.radius = saturnConfig.bloomRadius;

        this.composer = new THREE.EffectComposer(this.renderer);
        this.composer.addPass(renderScene);
        this.composer.addPass(bloomPass);
    }

    addListeners() {
        window.addEventListener('resize', () => {
            if (!this.camera || !this.container) return;

            const width = this.container.clientWidth;
            const height = this.container.clientHeight;

            this.camera.aspect = width / height;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(width, height);
            if (this.composer) {
                this.composer.setSize(width, height);
            }
        });
    }

    animate() {
        requestAnimationFrame(this.animate.bind(this));

        const dt = 0.016;
        this.time += dt;

        if (this.material) {
            this.material.uniforms.time.value = this.time;
        }

        // Slight idle camera movement
        if (this.camera) {
            this.camera.position.x = Math.sin(this.time * 0.05) * 5;
            this.camera.position.y = Math.cos(this.time * 0.05) * 5 + 20;
            this.camera.lookAt(0, 0, 0);
        }

        if (this.composer) {
            this.composer.render();
        } else if (this.renderer && this.scene && this.camera) {
            this.renderer.render(this.scene, this.camera);
        }
    }
}

// Auto-init
window.addEventListener('load', () => {
    new SaturnBackground('saturn-container');
});
