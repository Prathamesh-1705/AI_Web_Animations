/**
 * Sliding Window — 3D Perspective Carousel Engine
 * Implements the exact Framer mathematical coverflow algorithm:
 * - 3D non-linear compressed spacing
 * - Depth-of-field blur interpolation
 * - Y-axis curve rotation & Z-plane recession
 * - Critically damped spring physics
 * - Smooth touch/pointer drag, mouse wheel, and click-to-focus
 */

(function () {
  'use strict';

  // Carousel Configuration
  const CONFIG = {
    cardWidth: 460,
    cardHeight: 300,
    sideScale: 0.66,
    spacing: 40,
    depth: 150,
    curve: 42,
    perspective: 1300,
    stiffness: 170,
    damping: 34,
    mass: 1,
    radius: 6,
    maxBlur: 5,
    slides: [
      { image: 'images/slide1.jpg', caption: 'Northern Ridge' },
      { image: 'images/slide2.jpg', caption: 'Quiet Passage' },
      { image: 'images/slide3.jpg', caption: 'Still Water' },
      { image: 'images/slide4.jpg', caption: 'First Light' },
      { image: 'images/slide5.jpg', caption: 'Open Coast' },
      { image: 'images/slide6.jpg', caption: 'Long Horizon' },
    ],
  };

  const totalSlides = CONFIG.slides.length;

  // DOM Elements
  const viewport = document.getElementById('carousel-viewport');
  const stage = document.getElementById('perspective-stage');
  const track = document.getElementById('cards-track');
  const captionTitle = document.getElementById('caption-title');
  const captionCounter = document.getElementById('caption-counter');

  // Interactive & Physics State
  let targetProgress = 0;   // The target index (0 to totalSlides - 1)
  let currentProgress = 0;  // Spring-interpolated current position
  let velocity = 0;         // Spring velocity
  let isDragging = false;
  let dragStartX = 0;
  let dragStartProgress = 0;
  let lastPointerX = 0;
  let lastPointerTime = 0;
  let pointerVelocity = 0;
  let snapTimeout = null;

  // Card DOM cache
  const cardElements = [];

  // Math Helpers
  function clamp(val, min, max) {
    return Math.min(max, Math.max(min, val));
  }

  // Exact Framer Geometry Formulas:
  // 1. Horizontal X translation with non-linear compressed side spacing
  function calculateX(offset, cfg) {
    const sign = Math.sign(offset);
    const abs = Math.abs(offset);
    const baseStep = cfg.cardWidth * 0.46 + cfg.spacing;
    const sideStep = cfg.cardWidth * cfg.sideScale * 0.62;
    return abs <= 1 ? offset * baseStep : sign * (baseStep + (abs - 1) * sideStep);
  }

  // 2. Depth Z translation
  function calculateZ(offset, cfg) {
    return -Math.min(Math.abs(offset), 4) * cfg.depth;
  }

  // 3. Y-axis Rotation angle
  function calculateRotateY(offset, cfg) {
    return -Math.max(-1, Math.min(1, offset)) * cfg.curve;
  }

  // 4. Scale factor
  function calculateScale(offset, cfg) {
    return 1 - (1 - cfg.sideScale) * Math.min(Math.abs(offset), 1);
  }

  // 5. Opacity fade
  function calculateOpacity(offset) {
    const abs = Math.abs(offset);
    return 1 - Math.min(Math.max(abs - 3, 0) / 1.3, 1);
  }

  // 6. Depth-of-field blur
  function calculateBlur(offset, cfg) {
    return Math.min(Math.max(Math.abs(offset) - 0.35, 0) * 2.6, cfg.maxBlur);
  }

  // 7. Stacking order Z-Index
  function calculateZIndex(offset) {
    return Math.round(1000 - Math.abs(offset) * 10);
  }

  // Initialize and build slide cards
  function init() {
    updateResponsiveSettings();
    window.addEventListener('resize', () => {
      updateResponsiveSettings();
      render(0);
    });

    track.innerHTML = '';
    CONFIG.slides.forEach((slide, index) => {
      const card = document.createElement('div');
      card.className = 'slide-card';
      card.dataset.index = index;

      const img = document.createElement('img');
      img.src = slide.image;
      img.alt = slide.caption;
      img.draggable = false;
      card.appendChild(img);

      // Click to focus card
      card.addEventListener('click', (e) => {
        if (Math.abs(pointerVelocity) > 0.1) return;
        setTargetIndex(index);
      });

      track.appendChild(card);
      cardElements.push(card);
    });

    setupInteractions();
    startAnimationLoop();
    updateCaption();
  }

  function updateResponsiveSettings() {
    const isMobile = window.innerWidth <= 810;
    const isSmall = window.innerWidth <= 480;

    if (isSmall) {
      CONFIG.cardWidth = 290;
      CONFIG.cardHeight = 190;
      CONFIG.spacing = 24;
      CONFIG.depth = 110;
      CONFIG.curve = 38;
    } else if (isMobile) {
      CONFIG.cardWidth = 340;
      CONFIG.cardHeight = 220;
      CONFIG.spacing = 30;
      CONFIG.depth = 130;
      CONFIG.curve = 40;
    } else {
      CONFIG.cardWidth = 460;
      CONFIG.cardHeight = 300;
      CONFIG.spacing = 40;
      CONFIG.depth = 150;
      CONFIG.curve = 42;
    }

    stage.style.width = `${CONFIG.cardWidth}px`;
    stage.style.height = `${CONFIG.cardHeight}px`;
  }

  // Physics Animation Loop (Spring Simulation)
  let lastTime = performance.now();
  function startAnimationLoop() {
    function tick(now) {
      const dt = Math.min(0.06, (now - lastTime) / 1000);
      lastTime = now;

      if (!isDragging) {
        // Damped Harmonic Oscillator Spring: F = -k*(x - target) - c*v
        const displacement = currentProgress - targetProgress;
        const springForce = -CONFIG.stiffness * displacement;
        const dampingForce = -CONFIG.damping * velocity;
        const acceleration = (springForce + dampingForce) / CONFIG.mass;

        velocity += acceleration * dt;
        currentProgress += velocity * dt;

        // Rest snap if very close to rest
        if (Math.abs(displacement) < 0.001 && Math.abs(velocity) < 0.005) {
          currentProgress = targetProgress;
          velocity = 0;
        }
      }

      render(currentProgress);
      updateCaption();

      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  // Render each card according to fractional progress
  function render(progress) {
    for (let i = 0; i < totalSlides; i++) {
      const card = cardElements[i];
      if (!card) continue;

      const offset = i - progress;
      const x = calculateX(offset, CONFIG);
      const z = calculateZ(offset, CONFIG);
      const rotY = calculateRotateY(offset, CONFIG);
      const scale = calculateScale(offset, CONFIG);
      const opacity = calculateOpacity(offset);
      const blur = calculateBlur(offset, CONFIG);
      const zIndex = calculateZIndex(offset);

      card.style.transform = `translateX(${x.toFixed(2)}px) translateZ(${z.toFixed(2)}px) rotateY(${rotY.toFixed(2)}deg) scale(${scale.toFixed(4)})`;
      card.style.opacity = opacity.toFixed(3);
      card.style.filter = `blur(${blur.toFixed(2)}px)`;
      card.style.zIndex = zIndex;
      card.style.width = `${CONFIG.cardWidth}px`;
      card.style.height = `${CONFIG.cardHeight}px`;
    }
  }

  // Update caption text and counter
  let lastActiveIdx = -1;
  function updateCaption() {
    const activeIdx = clamp(Math.round(currentProgress), 0, totalSlides - 1);
    if (activeIdx !== lastActiveIdx) {
      lastActiveIdx = activeIdx;
      const slide = CONFIG.slides[activeIdx];
      if (slide) {
        captionTitle.textContent = slide.caption.toUpperCase();
        captionCounter.textContent = `${String(activeIdx + 1).padStart(2, '0')} — ${String(totalSlides).padStart(2, '0')}`;
      }
    }
  }

  function setTargetIndex(idx) {
    targetProgress = clamp(idx, 0, totalSlides - 1);
  }

  // Interactions: Mouse Wheel, Touch/Pointer Drag
  function setupInteractions() {
    // 1. Mouse Wheel / Trackpad horizontal/vertical swipe
    viewport.addEventListener(
      'wheel',
      (e) => {
        const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
        if (Math.abs(delta) < 0.5) return;
        e.preventDefault();

        targetProgress = clamp(targetProgress + delta * 0.0055, 0, totalSlides - 1);

        if (snapTimeout) clearTimeout(snapTimeout);
        snapTimeout = setTimeout(() => {
          targetProgress = clamp(Math.round(targetProgress), 0, totalSlides - 1);
        }, 160);
      },
      { passive: false }
    );

    // 2. Pointer Drag / Touch
    viewport.addEventListener('pointerdown', (e) => {
      isDragging = true;
      dragStartX = e.clientX;
      dragStartProgress = currentProgress;
      lastPointerX = e.clientX;
      lastPointerTime = performance.now();
      pointerVelocity = 0;

      try {
        viewport.setPointerCapture(e.pointerId);
      } catch (err) {}
      viewport.classList.add('is-dragging');
    });

    viewport.addEventListener('pointermove', (e) => {
      if (!isDragging) return;

      const now = performance.now();
      const dx = e.clientX - dragStartX;
      const stepDist = Math.max(120, CONFIG.cardWidth * 0.55);

      targetProgress = clamp(dragStartProgress - dx / stepDist, 0, totalSlides - 1);
      currentProgress = targetProgress; // lock progress directly to hand during drag

      const dt = Math.max(1, now - lastPointerTime) / 1000;
      pointerVelocity = (e.clientX - lastPointerX) / dt;
      lastPointerX = e.clientX;
      lastPointerTime = now;
    });

    const handlePointerEnd = (e) => {
      if (!isDragging) return;
      isDragging = false;

      try {
        viewport.releasePointerCapture(e.pointerId);
      } catch (err) {}
      viewport.classList.remove('is-dragging');

      const stepDist = Math.max(120, CONFIG.cardWidth * 0.55);
      // Kinetic momentum flick
      const flickIndex = targetProgress - (pointerVelocity * 150) / (stepDist * 1000);
      targetProgress = clamp(Math.round(flickIndex), 0, totalSlides - 1);
      velocity = -pointerVelocity / stepDist;
    };

    viewport.addEventListener('pointerup', handlePointerEnd);
    viewport.addEventListener('pointercancel', handlePointerEnd);
  }

  document.addEventListener('DOMContentLoaded', init);
})();
