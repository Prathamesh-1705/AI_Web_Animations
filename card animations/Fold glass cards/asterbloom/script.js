/**
 * Aster Bloom — Curved Ribbon Gallery
 * Complete GPU-accelerated WebGL curved ribbon carousel with:
 * - Gaussian Bulge deformation shader: across *= (1.0 + bulge * exp(-n^2 / 2sigma^2))
 * - Dynamic fullscreen crossfading blurred background
 * - Continuous smooth inertia glide physics
 * - Touch & pointer drag + mouse wheel interactions
 * - Automatic aspect-ratio cover UV projection
 */

(function () {
  'use strict';

  // --- Configuration ---
  const CONFIG = {
    // Gallery items with titles and high-res images
    items: [
      { id: 'the-collector', title: 'The Collector', src: 'images/collector.jpg' },
      { id: 'armour', title: 'Armour', src: 'images/armour.jpg' },
      { id: 'relic', title: 'Relic', src: 'images/relic.jpg' },
      { id: 'ember', title: 'Ember', src: 'images/ember.jpg' },
      { id: 'ritual', title: 'Ritual', src: 'images/ritual.jpg' },
      { id: 'pulse', title: 'Pulse', src: 'images/pulse.jpg' },
      { id: 'chess', title: 'Chess', src: 'images/chess.jpg' },
      { id: 'echo', title: 'Echo', src: 'images/echo.jpg' },
      { id: 'fruit', title: 'Fruit', src: 'images/fruit.jpg' },
      { id: 'cup', title: 'Cup', src: 'images/cup.jpg' },
    ],
    // Desktop layout
    itemWidth: 250,
    itemHeight: 200,
    gap: 10,
    orientation: 'horizontal', // or 'vertical' on mobile
    responsive: false,
    // Bulge effect
    bulgeStrength: 1.0,
    bulgeWidth: 0.3,
    // Physics & Interaction
    glide: 8,
    captureScroll: true,
    // Background crossfade
    showActiveBackground: true,
    bgFadeDuration: 300,
    bgOverlayColor: [0.0, 0.0, 0.0, 0.8], // RGBA
    backgroundColor: '#000000',
  };

  // --- GLSL Shaders ---

  // Common cover UV helper function
  const COVER_UV_GLSL = `
    vec2 coverUv(vec2 uv, vec2 texSize, vec2 boxSize) {
      float ta = texSize.x / max(texSize.y, 0.0001);
      float ba = boxSize.x / max(boxSize.y, 0.0001);
      if (ta > ba) {
        float s = ba / ta;
        uv.x = uv.x * s + (1.0 - s) * 0.5;
      } else {
        float s = ta / ba;
        uv.y = uv.y * s + (1.0 - s) * 0.5;
      }
      return uv;
    }
  `;

  // 1. Ribbon Vertex Shader (Gaussian Bulge Curve)
  const RIBBON_VS = `
    precision highp float;
    attribute vec2 aPosition;
    attribute vec2 aUv;
    uniform vec2 uResolution;
    uniform vec2 uItemSize;
    uniform float uOffset;
    uniform float uVertical;
    uniform float uBulgeStrength;
    uniform float uBulgeWidth;
    varying vec2 vUv;

    void main() {
      vec2 local = aPosition * uItemSize;
      float along = mix(local.x, -local.y, uVertical) + uOffset;
      float across = mix(local.y, local.x, uVertical);
      float alongSize = mix(uItemSize.x, uItemSize.y, uVertical);
      float halfLength = mix(uResolution.x, uResolution.y, uVertical) * 0.5;
      float n = along / halfLength;
      float sigma = max(0.0001, uBulgeWidth);
      float bulge = 1.0 + uBulgeStrength * exp(-(n * n) / (2.0 * sigma * sigma));
      across *= bulge;
      along += n * (bulge - 1.0) * alongSize * 0.9;
      vec2 world = uVertical > 0.5 ? vec2(across, -along) : vec2(along, across);
      gl_Position = vec4(world / (uResolution * 0.5), 0.0, 1.0);
      vUv = aUv;
    }
  `;

  // 2. Ribbon Fragment Shader (Texture sampler with aspect-ratio cover)
  const RIBBON_FS = `
    precision mediump float;
    uniform sampler2D uTexture;
    uniform vec2 uTextureSize;
    uniform vec2 uBoxSize;
    varying vec2 vUv;
    ${COVER_UV_GLSL}

    void main() {
      gl_FragColor = texture2D(uTexture, coverUv(vUv, uTextureSize, uBoxSize));
    }
  `;

  // 3. Background Fullscreen Quad Vertex Shader
  const BG_VS = `
    precision highp float;
    attribute vec2 aPosition;
    attribute vec2 aUv;
    varying vec2 vUv;
    void main() {
      vUv = aUv;
      gl_Position = vec4(aPosition, 0.0, 1.0);
    }
  `;

  // 4. Background Fragment Shader (Dual texture crossfade with dark overlay)
  const BG_FS = `
    precision mediump float;
    uniform sampler2D uTextureA;
    uniform sampler2D uTextureB;
    uniform vec2 uFrameSize;
    uniform vec2 uTextureSizeA;
    uniform vec2 uTextureSizeB;
    uniform float uMix;
    uniform vec4 uOverlay;
    varying vec2 vUv;
    ${COVER_UV_GLSL}

    void main() {
      vec3 a = texture2D(uTextureA, coverUv(vUv, uTextureSizeA, uFrameSize)).rgb;
      vec3 b = texture2D(uTextureB, coverUv(vUv, uTextureSizeB, uFrameSize)).rgb;
      vec3 color = mix(a, b, clamp(uMix, 0.0, 1.0));
      color = mix(color, uOverlay.rgb, clamp(uOverlay.a, 0.0, 1.0));
      gl_FragColor = vec4(color, 1.0);
    }
  `;

  // --- WebGL Helper Utilities ---

  function compileShader(gl, type, source) {
    const s = gl.createShader(type);
    gl.shaderSource(s, source);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.error('Shader compile error:', gl.getShaderInfoLog(s));
      gl.deleteShader(s);
      return null;
    }
    return s;
  }

  function createProgram(gl, vsSource, fsSource) {
    const vs = compileShader(gl, gl.VERTEX_SHADER, vsSource);
    const fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSource);
    if (!vs || !fs) return null;
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.error('Program link error:', gl.getProgramInfoLog(prog));
      gl.deleteProgram(prog);
      return null;
    }
    return prog;
  }

  // Create plane mesh grid for smooth curved deformation
  function createGridMesh(gl, segX, segY, size = 0.5) {
    const pos = [];
    const uv = [];
    const idx = [];

    for (let y = 0; y <= segY; y++) {
      for (let x = 0; x <= segX; x++) {
        const u = x / segX;
        const v = y / segY;
        pos.push((u - 0.5) * size * 2, (v - 0.5) * size * 2);
        uv.push(u, v);
      }
    }

    for (let y = 0; y < segY; y++) {
      for (let x = 0; x < segX; x++) {
        const row1 = y * (segX + 1) + x;
        const row2 = (y + 1) * (segX + 1) + x;
        idx.push(row1, row2, row1 + 1);
        idx.push(row1 + 1, row2, row2 + 1);
      }
    }

    const posBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(pos), gl.STATIC_DRAW);

    const uvBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, uvBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(uv), gl.STATIC_DRAW);

    const idxBuf = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuf);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(idx), gl.STATIC_DRAW);

    return {
      positionBuffer: posBuf,
      uvBuffer: uvBuf,
      indexBuffer: idxBuf,
      indexCount: idx.length,
    };
  }

  // Load image into WebGL texture
  function loadTexture(gl, src) {
    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
        resolve({
          texture: tex,
          width: img.naturalWidth || img.width,
          height: img.naturalHeight || img.height,
        });
      };
      img.onerror = () => {
        console.warn('Failed to load image:', src);
        resolve(null);
      };
      img.src = src;
    });
  }

  // Wrap coordinate inside [min, max] range
  function wrap(val, min, max) {
    const range = max - min;
    if (range <= 0) return min;
    let res = (val - min) % range;
    if (res < 0) res += range;
    return res + min;
  }

  // Clamp helper
  function clamp(val, min, max) {
    return Math.min(max, Math.max(min, val));
  }

  // Layout stride and virtual repeat calculation
  function computeLayout(cfg, viewW, viewH, itemCount) {
    const isVert = cfg.vertical;
    const viewLen = Math.max(1, isVert ? viewH : viewW);
    const viewCross = Math.max(1, isVert ? viewW : viewH);

    const scale = cfg.responsive
      ? clamp(Math.min(viewLen / 1200, viewCross / 500), 0.55, 1)
      : 1;

    const iw = cfg.itemWidth * scale;
    const ih = cfg.itemHeight * scale;
    const alongSize = isVert ? ih : iw;
    const stride = Math.max(1, alongSize + cfg.gap * scale);
    const n = Math.max(1, itemCount);

    // Repeat enough items to seamlessly loop across screen margins
    const virtualCount = n * Math.max(1, Math.ceil((viewLen * 1.6 + alongSize * 4) / (stride * n)));
    const total = stride * virtualCount;
    const centerIndex = Math.floor(virtualCount / 2);

    return {
      iw,
      ih,
      alongSize,
      crossSize: isVert ? iw : ih,
      viewLen,
      stride,
      n,
      virtualCount,
      total,
      centerIndex,
    };
  }

  // Determine active item index based on scroll position
  function getActiveIndex(currentScroll, layout) {
    let idx = Math.round(layout.centerIndex - currentScroll / layout.stride);
    idx = ((idx % layout.virtualCount) + layout.virtualCount) % layout.virtualCount;
    return idx % layout.n;
  }

  // --- Main Application ---

  let canvas, gl;
  let viewport;
  let ribbonProgram, bgProgram;
  let ribbonMesh, bgMesh;
  let ribbonUniforms = {}, bgUniforms = {};
  let textures = [];

  // Motion physics
  let scrollPos = 0;       // Current interpolated scroll
  let targetScroll = 0;    // Target scroll
  let velocity = 0;        // Inertia momentum
  let isDragging = false;
  let dragStartX = 0, dragStartY = 0;
  let lastPointerX = 0, lastPointerY = 0;
  let lastTime = 0;

  // Background crossfade state
  let currentBgIdx = 0;
  let targetBgIdx = 0;
  let bgMix = 1.0;
  let bgStartTime = 0;

  // DOM HUD
  let hudTitle, hudCounter;

  async function init() {
    viewport = document.getElementById('gallery-viewport');
    canvas = document.getElementById('ribbon-canvas');
    hudTitle = document.getElementById('project-title');
    hudCounter = document.getElementById('project-counter');

    gl = canvas.getContext('webgl', { alpha: false, antialias: true, powerPreference: 'high-performance' });
    if (!gl) {
      console.error('WebGL not supported');
      return;
    }

    // Check responsive mobile
    updateConfigForScreen();
    window.addEventListener('resize', handleResize);

    // Build Shader Programs
    ribbonProgram = createProgram(gl, RIBBON_VS, RIBBON_FS);
    bgProgram = createProgram(gl, BG_VS, BG_FS);

    // Cache Uniform Locations
    ribbonUniforms = {
      uResolution: gl.getUniformLocation(ribbonProgram, 'uResolution'),
      uItemSize: gl.getUniformLocation(ribbonProgram, 'uItemSize'),
      uOffset: gl.getUniformLocation(ribbonProgram, 'uOffset'),
      uVertical: gl.getUniformLocation(ribbonProgram, 'uVertical'),
      uBulgeStrength: gl.getUniformLocation(ribbonProgram, 'uBulgeStrength'),
      uBulgeWidth: gl.getUniformLocation(ribbonProgram, 'uBulgeWidth'),
      uTexture: gl.getUniformLocation(ribbonProgram, 'uTexture'),
      uTextureSize: gl.getUniformLocation(ribbonProgram, 'uTextureSize'),
      uBoxSize: gl.getUniformLocation(ribbonProgram, 'uBoxSize'),
    };

    bgUniforms = {
      uTextureA: gl.getUniformLocation(bgProgram, 'uTextureA'),
      uTextureB: gl.getUniformLocation(bgProgram, 'uTextureB'),
      uFrameSize: gl.getUniformLocation(bgProgram, 'uFrameSize'),
      uTextureSizeA: gl.getUniformLocation(bgProgram, 'uTextureSizeA'),
      uTextureSizeB: gl.getUniformLocation(bgProgram, 'uTextureSizeB'),
      uMix: gl.getUniformLocation(bgProgram, 'uMix'),
      uOverlay: gl.getUniformLocation(bgProgram, 'uOverlay'),
    };

    // Create Meshes
    // High subdivision grid for the ribbon so Gaussian curve is ultra-smooth
    ribbonMesh = createGridMesh(gl, 48, 16, 0.5);
    // 2-triangle quad for fullscreen background
    bgMesh = createGridMesh(gl, 1, 1, 1.0);

    // Load Textures
    const texPromises = CONFIG.items.map((item) => loadTexture(gl, item.src));
    const loaded = await Promise.all(texPromises);
    textures = loaded.filter(Boolean);

    if (textures.length === 0) {
      console.warn('No textures loaded');
      return;
    }

    handleResize();
    setupEvents();

    lastTime = performance.now();
    requestAnimationFrame(renderLoop);
  }

  function updateConfigForScreen() {
    const isMobile = window.innerWidth <= 810;
    if (isMobile) {
      CONFIG.vertical = true;
      CONFIG.itemWidth = 150;
      CONFIG.itemHeight = 250;
      CONFIG.gap = 10;
      CONFIG.bulgeStrength = 0.9;
    } else {
      CONFIG.vertical = false;
      CONFIG.itemWidth = 250;
      CONFIG.itemHeight = 200;
      CONFIG.gap = 10;
      CONFIG.bulgeStrength = 1.0;
    }
  }

  function handleResize() {
    updateConfigForScreen();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = viewport.clientWidth;
    const h = viewport.clientHeight;

    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    gl.viewport(0, 0, canvas.width, canvas.height);
  }

  function setupEvents() {
    // 1. Mouse Wheel / Trackpad
    viewport.addEventListener(
      'wheel',
      (e) => {
        let delta = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? window.innerHeight : 1;
        let dx = e.deltaX * delta;
        let dy = e.deltaY * delta;
        let deltaVal = 0;

        if (CONFIG.captureScroll) {
          deltaVal = Math.abs(dx) > Math.abs(dy) ? dx : dy;
        } else if (!CONFIG.vertical && Math.abs(dx) > Math.abs(dy)) {
          deltaVal = dx;
        } else if (CONFIG.vertical && Math.abs(dy) > Math.abs(dx)) {
          deltaVal = dy;
        } else {
          return;
        }

        e.preventDefault();
        velocity = 0;
        targetScroll -= deltaVal;
      },
      { passive: false }
    );

    // 2. Pointer Drag
    viewport.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      isDragging = true;
      dragStartX = lastPointerX = e.clientX;
      dragStartY = lastPointerY = e.clientY;
      velocity = 0;

      try {
        viewport.setPointerCapture(e.pointerId);
      } catch (err) {}
      viewport.classList.add('is-dragging');
    });

    viewport.addEventListener('pointermove', (e) => {
      if (!isDragging) return;
      const dx = e.clientX - lastPointerX;
      const dy = e.clientY - lastPointerY;
      lastPointerX = e.clientX;
      lastPointerY = e.clientY;

      const movement = CONFIG.vertical ? dy : dx;
      targetScroll += movement;

      const now = performance.now();
      const dt = Math.max(1, now - lastTime) / 1000;
      velocity = velocity * 0.3 + (movement / dt) * 0.7;
    });

    const endDrag = (e) => {
      if (!isDragging) return;
      isDragging = false;
      try {
        viewport.releasePointerCapture(e.pointerId);
      } catch (err) {}
      viewport.classList.remove('is-dragging');
      velocity = clamp(velocity, -6000, 6000);
    };

    viewport.addEventListener('pointerup', endDrag);
    viewport.addEventListener('pointercancel', endDrag);
  }

  function bindMesh(mesh, aPos, aUv) {
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.positionBuffer);
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.uvBuffer);
    gl.enableVertexAttribArray(aUv);
    gl.vertexAttribPointer(aUv, 2, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, mesh.indexBuffer);
  }

  // Animation render loop
  function renderLoop(time) {
    requestAnimationFrame(renderLoop);

    const dt = Math.min(0.05, Math.max(0, (time - lastTime) / 1000));
    lastTime = time;

    // Physics spring / glide integration
    if (isDragging) {
      scrollPos = targetScroll;
    } else {
      if (Math.abs(velocity) > 5) {
        targetScroll += velocity * dt;
        velocity *= Math.exp(-dt * CONFIG.glide);
      } else {
        velocity = 0;
      }
      const diff = targetScroll - scrollPos;
      if (Math.abs(diff) < 0.05) {
        scrollPos = targetScroll;
      } else {
        scrollPos += diff * (1 - Math.exp(-dt * 16));
      }
    }

    const viewW = canvas.width;
    const viewH = canvas.height;
    if (viewW === 0 || viewH === 0 || textures.length === 0) return;

    const layout = computeLayout(CONFIG, viewW, viewH, textures.length);

    // Active project index
    const activeIdx = getActiveIndex(scrollPos, layout);

    // Update Background crossfade
    if (CONFIG.showActiveBackground) {
      if (activeIdx !== targetBgIdx) {
        currentBgIdx = bgMix >= 0.5 ? targetBgIdx : currentBgIdx;
        targetBgIdx = activeIdx;
        bgStartTime = time;
        bgMix = 0.0;
      }

      if (bgMix < 1.0) {
        bgMix = Math.min(1.0, (time - bgStartTime) / Math.max(50, CONFIG.bgFadeDuration));
      }
    }

    // Update HUD text
    const activeItem = CONFIG.items[activeIdx];
    if (activeItem) {
      if (hudTitle.textContent !== activeItem.title.toUpperCase()) {
        hudTitle.textContent = activeItem.title.toUpperCase();
        hudCounter.textContent = `${String(activeIdx + 1).padStart(2, '0')} / ${String(CONFIG.items.length).padStart(2, '0')}`;
      }
    }

    // --- Render WebGL ---
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    // 1. Draw Fullscreen Background Crossfade
    if (CONFIG.showActiveBackground && bgProgram) {
      gl.useProgram(bgProgram);
      const posLoc = gl.getAttribLocation(bgProgram, 'aPosition');
      const uvLoc = gl.getAttribLocation(bgProgram, 'aUv');
      bindMesh(bgMesh, posLoc, uvLoc);

      const texA = textures[currentBgIdx];
      const texB = textures[targetBgIdx];

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texA.texture);
      gl.uniform1i(bgUniforms.uTextureA, 0);

      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, texB.texture);
      gl.uniform1i(bgUniforms.uTextureB, 1);

      gl.uniform2f(bgUniforms.uFrameSize, viewW, viewH);
      gl.uniform2f(bgUniforms.uTextureSizeA, texA.width, texA.height);
      gl.uniform2f(bgUniforms.uTextureSizeB, texB.width, texB.height);
      gl.uniform1f(bgUniforms.uMix, bgMix);
      gl.uniform4fv(bgUniforms.uOverlay, CONFIG.bgOverlayColor);

      gl.drawElements(gl.TRIANGLES, bgMesh.indexCount, gl.UNSIGNED_SHORT, 0);
    }

    // 2. Draw Curved Ribbon Cards
    gl.useProgram(ribbonProgram);
    const rPosLoc = gl.getAttribLocation(ribbonProgram, 'aPosition');
    const rUvLoc = gl.getAttribLocation(ribbonProgram, 'aUv');
    bindMesh(ribbonMesh, rPosLoc, rUvLoc);

    gl.uniform2f(ribbonUniforms.uResolution, viewW, viewH);
    gl.uniform2f(ribbonUniforms.uItemSize, layout.iw, layout.ih);
    gl.uniform2f(ribbonUniforms.uBoxSize, layout.iw, layout.ih);
    gl.uniform1f(ribbonUniforms.uVertical, CONFIG.vertical ? 1.0 : 0.0);
    gl.uniform1f(ribbonUniforms.uBulgeStrength, CONFIG.bulgeStrength);
    gl.uniform1f(ribbonUniforms.uBulgeWidth, CONFIG.bulgeWidth);

    const cullingThreshold = layout.viewLen * 0.6 + layout.alongSize * 2;
    let boundTex = null;

    for (let i = 0; i < layout.virtualCount; i++) {
      const offset = wrap(
        (i - layout.centerIndex) * layout.stride + scrollPos,
        -layout.total / 2,
        layout.total / 2
      );

      if (Math.abs(offset) > cullingThreshold) continue;

      const texData = textures[i % layout.n];
      if (texData.texture !== boundTex) {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, texData.texture);
        gl.uniform1i(ribbonUniforms.uTexture, 0);
        gl.uniform2f(ribbonUniforms.uTextureSize, texData.width, texData.height);
        boundTex = texData.texture;
      }

      gl.uniform1f(ribbonUniforms.uOffset, offset);
      gl.drawElements(gl.TRIANGLES, ribbonMesh.indexCount, gl.UNSIGNED_SHORT, 0);
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();

