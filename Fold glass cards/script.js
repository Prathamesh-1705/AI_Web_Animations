/**
 * Glass Fold Ticker - Exact 3D Parametric Folding Engine
 * Recreates the exact multi-facet glass cylinder curve fold animation.
 */

(function () {
  'use strict';

  // Math helpers
  function clamp(val, min, max) {
    return Math.min(max, Math.max(min, val));
  }

  function mod(n, m) {
    return ((n % m) + m) % m;
  }

  function hashNoise(i) {
    const t = Math.sin(i * 12.9898 + 4.1) * 43758.5453;
    return 0.5 + 0.9 * (t - Math.floor(t));
  }

  function parseRadius(radiusStr) {
    const parts = String(radiusStr || '0px').trim().split(/\s+/);
    if (parts.length === 1) return [parts[0], parts[0], parts[0], parts[0]];
    if (parts.length === 2) return [parts[0], parts[1], parts[0], parts[1]];
    if (parts.length === 3) return [parts[0], parts[1], parts[2], parts[1]];
    return [parts[0], parts[1], parts[2], parts[3]];
  }

  function getFacetRadius(facetIndex, totalFacets, r) {
    const isFirst = facetIndex === 0;
    const isLast = facetIndex === totalFacets - 1;
    if (isFirst && isLast) return `${r[0]} ${r[1]} ${r[2]} ${r[3]}`;
    if (isFirst) return `${r[0]} 0px 0px ${r[3]}`;
    if (isLast) return `0px ${r[1]} ${r[2]} 0px`;
    return '0px';
  }

  // 3D Curve evaluator: Flat center -> Circular transition -> Tangential angled wall
  function evaluateCurve(s, cfg, out) {
    const absS = Math.abs(s);
    if (absS <= cfg.F || cfg.theta < 1e-4) {
      out.x = s;
      out.z = 0;
      return out;
    }

    const sign = s < 0 ? -1 : 1;
    const distPastFlat = absS - cfg.F;
    const arcLength = cfg.R * cfg.theta;
    let x, z;

    if (distPastFlat <= arcLength) {
      const alpha = distPastFlat / cfg.R;
      x = cfg.F + cfg.R * Math.sin(alpha);
      z = cfg.R * (1 - Math.cos(alpha));
    } else {
      const straightDist = distPastPastArc(distPastFlat, arcLength);
      x = cfg.F + cfg.R * Math.sin(cfg.theta) + straightDist * Math.cos(cfg.theta);
      z = cfg.R * (1 - Math.cos(cfg.theta)) + straightDist * Math.sin(cfg.theta);
    }

    out.x = sign * x;
    out.z = cfg.t * z; // cfg.t is +1 for walls curving toward camera
    return out;
  }

  function distPastPastArc(d, arc) {
    return d - arc;
  }

  // Perspective 2D projection for cull bounds
  function projectX(p, cfg) {
    const z = Math.min(p.z, cfg.hideZ);
    return (p.x * cfg.perspective) / (cfg.perspective - z);
  }

  const DEG_RAD = 180 / Math.PI;
  const tempP1 = { x: 0, z: 0 };
  const tempP2 = { x: 0, z: 0 };
  const tempProbe = { x: 0, z: 0 };

  // Calculate layout geometry, slots, and loop dimensions
  function calculateLayout(stageWidth, rootWidth, cardW, gapVal, imageCount, facetCount, depthCfg) {
    const w = Math.max(20, cardW);
    const step = w + Math.max(0, gapVal);
    const perspective = Math.max(200, depthCfg.perspective);
    const theta = (clamp(depthCfg.angle, 0, 85) * Math.PI) / 180;
    const flatFrac = clamp(depthCfg.flat, 0, 100) / 100;

    const layout = {
      w: w,
      fw: w / facetCount,
      facets: facetCount,
      step: step,
      slots: imageCount,
      loop: imageCount * step,
      shift: 0,
      F: Math.max(0, (stageWidth * flatFrac) / 2),
      R: Math.max(1, depthCfg.curve),
      theta: theta,
      t: depthCfg.walls === 'away' ? -1 : 1,
      perspective: perspective,
      hideZ: perspective * 0.8,
      cullHalf: Math.max(stageWidth, rootWidth) / 2 + 80,
      sinNorm: Math.max(0.001, Math.sin(theta)),
    };

    const cullTarget = layout.cullHalf + w;
    let maxVisibleDist = layout.F + w;

    for (let e = 0; e <= 16000; e += 10) {
      evaluateCurve(layout.F + e, layout, tempProbe);
      maxVisibleDist = layout.F + e;
      if (Math.abs(tempProbe.z) >= layout.hideZ || projectX(tempProbe, layout) > cullTarget) {
        break;
      }
    }

    const m = Math.max(1, imageCount);
    const visibleSpan = 2 * (maxVisibleDist + w) + step;
    let slotCount = m * Math.ceil(visibleSpan / (m * step));
    if (slotCount > 30) {
      slotCount = m * Math.max(1, Math.floor(30 / m));
    }

    const safeFacets = clamp(Math.min(facetCount, Math.floor(220 / slotCount)), 1, 12);
    layout.facets = safeFacets;
    layout.fw = w / safeFacets;
    layout.slots = slotCount;
    layout.loop = slotCount * step;
    layout.shift = slotCount % 2 === 0 ? step / 2 : 0;

    return layout;
  }

  // Compute transform, image slide, visibility, and lighting turn for each facet
  function computeFacetState(slotIndex, facetIndex, scrollPos, layout, refraction) {
    const cardCenter = mod(slotIndex * layout.step - scrollPos, layout.loop) - layout.loop / 2 + layout.shift;
    const facetOffset = facetIndex * layout.fw;
    const leftX = cardCenter - layout.w / 2 + facetOffset;

    const p1 = evaluateCurve(leftX, layout, tempP1);
    const x1 = p1.x;
    const z1 = p1.z;

    const p2 = evaluateCurve(leftX + layout.fw, layout, tempP2);
    const dx = p2.x - x1;
    const dz = p2.z - z1;

    const segLen = Math.sqrt(dx * dx + dz * dz) || 1e-4;
    const angleRad = Math.atan2(-dz, dx);
    const angleDeg = angleRad * DEG_RAD;

    const proj1 = projectX(p1, layout);
    const proj2 = projectX(p2, layout);

    const isVisible =
      Math.abs(z1) < layout.hideZ &&
      Math.max(proj1, proj2) > -layout.cullHalf &&
      Math.min(proj1, proj2) < layout.cullHalf;

    const slideX = clamp(
      -Math.sin(angleRad) * refraction * hashNoise(facetIndex),
      facetOffset + layout.fw - layout.w,
      facetOffset
    );

    const scaleMult = facetIndex < layout.facets - 1 || layout.step === layout.w ? 1.003 : 1;
    const scaleX = (segLen / layout.fw) * scaleMult;

    return {
      transform: `translate3d(${x1.toFixed(1)}px, 0px, ${z1.toFixed(1)}px) rotateY(${angleDeg.toFixed(2)}deg) scaleX(${scaleX.toFixed(4)})`,
      slide: `translate3d(${slideX.toFixed(2)}px, 0px, 0px)`,
      visible: isVisible,
      turn: clamp(Math.abs(Math.sin(angleRad)) / layout.sinNorm, 0, 1),
    };
  }

  // --- Configuration ---
  const SETTINGS = {
    images: [
      { src: 'images/dune_path.jpg', alt: 'Winding coastal boardwalk through dune flora' },
      { src: 'images/modern_portal.jpg', alt: 'Minimalist concrete architectural portal' },
      { src: 'images/coastal_heather.jpg', alt: 'Vibrant coastal headland with blooming heather' },
    ],
    cardWidth: 600,
    cardHeight: 420,
    gap: 12,
    speed: 45,
    direction: 'left',
    draggable: true,
    pauseOnHover: true,
    card: {
      fill: 'rgb(30, 30, 34)',
      radius: '12px',
    },
    glass: {
      facets: 5,
      refraction: 8,
      chroma: 12,
      sheen: 12,
      light: 10,
      edge: 'rgba(158, 158, 158, 0.2)',
      edgeWidth: 0.5,
    },
    depth: {
      flat: 70,
      angle: 58,
      curve: 200,
      perspective: 1100,
      walls: 'toward',
    },
  };

  // State
  let layout = null;
  let scrollPos = 0;
  let currentVelocity = 0;
  let isHovered = false;

  const drag = {
    active: false,
    pointerId: -1,
    lastX: 0,
    lastT: 0,
    vel: 0,
  };

  // DOM Elements cache
  let viewportEl = null;
  let stageEl = null;
  let facetElements = [];
  let imageContainers = [];
  let sheenElements = [];
  let cachedStyles = [];

  function init() {
    viewportEl = document.getElementById('ticker-viewport');
    stageEl = document.getElementById('stage-container');
    if (!viewportEl || !stageEl) return;

    // Check responsive sizes
    updateDimensions();

    window.addEventListener('resize', () => {
      updateDimensions();
      rebuildDOM();
    });

    setupInteraction();
    rebuildDOM();

    // Start render loop
    let lastTime = performance.now();
    function loop(now) {
      const dt = Math.min(0.05, (now - lastTime) / 1000);
      lastTime = now;

      if (drag.active) {
        currentVelocity = drag.vel;
      } else {
        const targetSpeed = SETTINGS.speed * (SETTINGS.direction === 'left' ? 1 : -1);
        const effectiveSpeed = SETTINGS.pauseOnHover && isHovered ? 0 : targetSpeed;
        currentVelocity += (effectiveSpeed - currentVelocity) * Math.min(1, dt * 3);
        scrollPos += currentVelocity * dt;
      }

      scrollPos = mod(scrollPos, layout.loop);
      renderFacets();

      requestAnimationFrame(loop);
    }
    requestAnimationFrame(loop);
  }

  function updateDimensions() {
    const isMobile = window.innerWidth <= 810;
    SETTINGS.cardWidth = isMobile ? 400 : 600;
    SETTINGS.cardHeight = isMobile ? 320 : 420;
    stageEl.style.height = `${SETTINGS.cardHeight}px`;

    const stageW = stageEl.offsetWidth || window.innerWidth;
    const rootW = viewportEl.offsetWidth || window.innerWidth;

    layout = calculateLayout(
      stageW,
      rootW,
      SETTINGS.cardWidth,
      SETTINGS.gap,
      SETTINGS.images.length,
      SETTINGS.glass.facets,
      SETTINGS.depth
    );

    stageEl.style.perspective = `${layout.perspective}px`;
  }

  function rebuildDOM() {
    stageEl.innerHTML = '';
    facetElements = [];
    imageContainers = [];
    sheenElements = [];
    cachedStyles = [];

    const numSlots = layout.slots;
    const numFacets = layout.facets;
    const fw = layout.fw;
    const cardRadiusParsed = parseRadius(SETTINGS.card.radius);

    const chroma = clamp(SETTINGS.glass.chroma, 0, 100) / 100;
    const sheen = clamp(SETTINGS.glass.sheen, 0, 100) / 100;
    const light = clamp(SETTINGS.glass.light, 0, 100) / 100;

    // Build gradient layers for the chromatic sheen
    const sheenGradients = [];
    if (chroma > 0) {
      sheenGradients.push(
        `linear-gradient(90deg, rgba(120,210,255,${(0.55 * chroma).toFixed(3)}) 0%, rgba(120,210,255,0) 18%, rgba(0,0,0,0) 50%, rgba(255,120,190,0) 82%, rgba(255,120,190,${(0.55 * chroma).toFixed(3)}) 100%)`
      );
    }
    if (sheen > 0) {
      sheenGradients.push(
        `linear-gradient(104deg, rgba(255,255,255,${(0.45 * sheen).toFixed(3)}) 0%, rgba(255,255,255,0) 58%)`
      );
    }
    if (light > 0) {
      sheenGradients.push(
        `linear-gradient(0deg, rgba(5,7,12,${light.toFixed(3)}), rgba(5,7,12,${light.toFixed(3)}))`
      );
    }
    const sheenBg = sheenGradients.join(', ');

    for (let s = 0; s < numSlots; s++) {
      const imgData = SETTINGS.images[s % SETTINGS.images.length];

      for (let f = 0; f < numFacets; f++) {
        const flatIdx = s * numFacets + f;
        const facetRadius = getFacetRadius(f, numFacets, cardRadiusParsed);

        // 1. Outer Facet Strip
        const strip = document.createElement('div');
        strip.className = 'facet-strip';
        strip.style.width = `${fw}px`;
        strip.style.height = `${SETTINGS.cardHeight}px`;
        strip.style.borderRadius = facetRadius;

        // 2. Inner Image Container (offset horizontally to align image slice)
        const imgContainer = document.createElement('div');
        imgContainer.className = 'facet-image-container';
        imgContainer.style.width = `${SETTINGS.cardWidth}px`;
        imgContainer.style.left = `${-f * fw}px`;
        imgContainer.style.borderRadius = SETTINGS.card.radius;

        const img = document.createElement('img');
        img.src = imgData.src;
        img.alt = imgData.alt;
        img.draggable = false;
        imgContainer.appendChild(img);
        strip.appendChild(imgContainer);

        // 3. Glass Edge & Surface Specular Highlight
        if (sheen > 0 || SETTINGS.glass.edgeWidth > 0) {
          const edgeEl = document.createElement('div');
          edgeEl.className = 'facet-glass-edge';
          edgeEl.style.borderRadius = facetRadius;
          if (sheen > 0) {
            edgeEl.style.backgroundImage = `linear-gradient(104deg, rgba(255,255,255,${(sheen * 0.3).toFixed(3)}) 0%, rgba(255,255,255,0) 46%)`;
          }
          if (SETTINGS.glass.edgeWidth > 0 && f > 0) {
            edgeEl.style.borderLeft = `${SETTINGS.glass.edgeWidth}px solid ${SETTINGS.glass.edge}`;
          }
          strip.appendChild(edgeEl);
        }

        // 4. Dynamic Chromatic / Angle Sheen Overlay
        if (sheenBg) {
          const sheenEl = document.createElement('div');
          sheenEl.className = 'facet-glass-sheen';
          sheenEl.style.borderRadius = facetRadius;
          sheenEl.style.backgroundImage = sheenBg;
          strip.appendChild(sheenEl);
          sheenElements[flatIdx] = sheenEl;
        }

        stageEl.appendChild(strip);
        facetElements[flatIdx] = strip;
        imageContainers[flatIdx] = imgContainer;
        cachedStyles[flatIdx] = {};
      }
    }
  }

  function renderFacets() {
    const numSlots = layout.slots;
    const numFacets = layout.facets;
    const refraction = clamp(SETTINGS.glass.refraction, 0, 60);

    for (let s = 0; s < numSlots; s++) {
      for (let f = 0; f < numFacets; f++) {
        const flatIdx = s * numFacets + f;
        const strip = facetElements[flatIdx];
        if (!strip) continue;

        const state = computeFacetState(s, f, scrollPos, layout, refraction);
        const cache = cachedStyles[flatIdx] || (cachedStyles[flatIdx] = {});

        const visibilityStr = state.visible ? 'visible' : 'hidden';
        if (cache.v !== visibilityStr) {
          strip.style.visibility = visibilityStr;
          cache.v = visibilityStr;
        }

        if (state.visible) {
          if (cache.t !== state.transform) {
            strip.style.transform = state.transform;
            cache.t = state.transform;
          }

          if (refraction > 0 && cache.s !== state.slide) {
            const imgBox = imageContainers[flatIdx];
            if (imgBox) {
              imgBox.style.transform = state.slide;
            }
            cache.s = state.slide;
          }

          if (sheenElements[flatIdx] && cache.k !== state.turn) {
            sheenElements[flatIdx].style.opacity = state.turn.toFixed(3);
            cache.k = state.turn;
          }
        }
      }
    }
  }

  function setupInteraction() {
    viewportEl.addEventListener('pointerenter', (e) => {
      if (e.pointerType === 'mouse') isHovered = true;
    });

    viewportEl.addEventListener('pointerleave', (e) => {
      if (e.pointerType === 'mouse') isHovered = false;
    });

    viewportEl.addEventListener('pointerdown', (e) => {
      if (!SETTINGS.draggable) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;

      drag.active = true;
      drag.pointerId = e.pointerId;
      drag.lastX = e.clientX;
      drag.lastT = performance.now();
      drag.vel = 0;

      try {
        viewportEl.setPointerCapture(e.pointerId);
      } catch (err) {}
      viewportEl.classList.add('grabbing');
    });

    viewportEl.addEventListener('pointermove', (e) => {
      if (!drag.active || e.pointerId !== drag.pointerId) return;

      const now = performance.now();
      const dx = e.clientX - drag.lastX;
      const dt = Math.max(1, now - drag.lastT) / 1000;

      scrollPos -= dx;
      drag.vel = drag.vel * 0.6 + (-dx / dt) * 0.4;
      drag.lastX = e.clientX;
      drag.lastT = now;
    });

    const endDrag = (e) => {
      if (!drag.active || e.pointerId !== drag.pointerId) return;
      drag.active = false;

      const isStale = performance.now() - drag.lastT > 80;
      currentVelocity = isStale ? 0 : clamp(drag.vel, -4000, 4000);

      try {
        viewportEl.releasePointerCapture(e.pointerId);
      } catch (err) {}
      viewportEl.classList.remove('grabbing');
    };

    viewportEl.addEventListener('pointerup', endDrag);
    viewportEl.addEventListener('pointercancel', endDrag);
  }

  document.addEventListener('DOMContentLoaded', init);
})();
