/* ================================================================
   POWERAUDIO - Audio Visualization Library
   Converted from TypeScript with theme color support
   Original: https://github.com/nicmusso/poweraudio
   Modified for Widget Wall Desktop - Havens Consulting Inc.
   Fingerprint: AE-WWD-PA01 | analyticendeavors.com
   ================================================================ */

(function(global) {
  'use strict';

  // Check for PIXI.js
  if (typeof PIXI === 'undefined') {
    console.error('PowerAudio: PIXI.js is required but not loaded');
    return;
  }

  const BIN_COUNT = 256;

  // ================================================================
  // Point Utility
  // ================================================================
  class Point {
    static distance(point1, point2) {
      return Math.sqrt(
        Math.pow(point1.x - point2.x, 2) +
        Math.pow(point1.y - point2.y, 2)
      );
    }
  }

  // ================================================================
  // DisplayObject - Base class with physics
  // ================================================================
  let displayObjectId = 1;

  class DisplayObject extends PIXI.Container {
    constructor(stage, appendGraphics = true) {
      super();

      this.id = displayObjectId++;
      this.stage = stage;
      this.graphics = undefined;
      this.velocity = new PIXI.Point(0, 0);
      this.acceleration = new PIXI.Point(0, 0);
      this.friction = new PIXI.Point(0, 0);
      this.forces = {};
      this.mass = 1;

      if (appendGraphics) {
        this.graphics = new PIXI.Graphics();
        this.addChild(this.graphics);
      }
    }

    setForce(name, vector) {
      if (isNaN(vector.x) || isNaN(vector.y)) {
        return;
      }
      this.forces[name] = { x: vector.x, y: vector.y };
    }

    clearForce(name) {
      delete this.forces[name];
    }

    clearForces() {
      this.forces = {};
    }

    setFriction(value) {
      if (typeof value === 'number') {
        this.friction = new PIXI.Point(value, value);
      } else {
        this.friction.set(value.x, value.y);
      }
    }

    update(delta) {
      // Friction force
      this.setForce('friction', new PIXI.Point(
        -this.friction.x * this.velocity.x,
        -this.friction.y * this.velocity.y
      ));

      // Calculate acceleration from all forces
      this.acceleration.set(0, 0);
      for (const forceName in this.forces) {
        this.acceleration.x += this.forces[forceName].x;
        this.acceleration.y += this.forces[forceName].y;
      }
      this.acceleration.x /= this.mass;
      this.acceleration.y /= this.mass;

      // Update velocity
      this.velocity.x += delta * this.acceleration.x;
      this.velocity.y += delta * this.acceleration.y;

      // Update position
      this.position.x += delta * this.velocity.x;
      this.position.y += delta * this.velocity.y;
    }
  }

  // ================================================================
  // DisplayObjectContainer
  // ================================================================
  class DisplayObjectContainer extends DisplayObject {
    constructor(stage) {
      super(stage, false);
    }

    update(delta) {
      super.update(delta);

      for (let i = 0; i < this.children.length; i++) {
        const child = this.children[i];
        if (child.update) {
          child.update(delta);
        }
      }
    }
  }

  // ================================================================
  // AnimatedBackground
  // ================================================================
  class AnimatedBackground extends DisplayObject {
    constructor(stage) {
      super(stage);
    }

    update(delta) {
      super.update(delta);
      this.redraw();
    }

    redraw() {
      // Background disabled - let CSS handle it for transparency
      if (this.graphics) {
        this.graphics.clear();
      }
    }
  }

  // ================================================================
  // Color Utility - Hue shifting for color variation
  // ================================================================
  function shiftHue(color, degrees) {
    // Convert hex to RGB
    const r = (color >> 16) & 0xFF;
    const g = (color >> 8) & 0xFF;
    const b = color & 0xFF;

    // Convert RGB to HSL
    const rNorm = r / 255, gNorm = g / 255, bNorm = b / 255;
    const max = Math.max(rNorm, gNorm, bNorm);
    const min = Math.min(rNorm, gNorm, bNorm);
    let h, s, l = (max + min) / 2;

    if (max === min) {
      h = s = 0;
    } else {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch (max) {
        case rNorm: h = ((gNorm - bNorm) / d + (gNorm < bNorm ? 6 : 0)) / 6; break;
        case gNorm: h = ((bNorm - rNorm) / d + 2) / 6; break;
        case bNorm: h = ((rNorm - gNorm) / d + 4) / 6; break;
      }
    }

    // Shift hue
    h = (h + degrees / 360) % 1;
    if (h < 0) h += 1;

    // Convert back to RGB
    let rOut, gOut, bOut;
    if (s === 0) {
      rOut = gOut = bOut = l;
    } else {
      const hue2rgb = (p, q, t) => {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1/6) return p + (q - p) * 6 * t;
        if (t < 1/2) return q;
        if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
        return p;
      };
      const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      const p = 2 * l - q;
      rOut = hue2rgb(p, q, h + 1/3);
      gOut = hue2rgb(p, q, h);
      bOut = hue2rgb(p, q, h - 1/3);
    }

    return (Math.round(rOut * 255) << 16) | (Math.round(gOut * 255) << 8) | Math.round(bOut * 255);
  }

  // ================================================================
  // Node - Orbiting particles
  // ================================================================
  class Node extends DisplayObject {
    constructor(stage) {
      super(stage);

      // Random size
      this.radius = 2 + Math.random() * 4;
      // Will be set to theme color
      this.color = 0xFFFFFF;
      // Random color index for variety (0=primary, 1=secondary, 2=accent)
      this.colorIndex = Math.floor(Math.random() * 3);
      // Random hue offset for additional color variation (-60 to +60 degrees)
      this.hueOffset = (Math.random() - 0.5) * 120;
      this.setFriction(1);
      // Spore burst timing (stagger initial bursts)
      this.timeSinceLastBurst = Math.random() * 5;
      // Random value to compare against sporeChance
      this.sporeRoll = Math.random();
    }

    update(delta) {
      super.update(delta);

      // Audio-reactive movement boost
      const coef = Math.max(0.1, this.stage.viz.waveform.averageGain * 8);
      this.position.x += delta * this.velocity.x * (coef - 1);
      this.position.y += delta * this.velocity.y * (coef - 1);

      // Wrap around screen edges
      if (this.x < 0) this.x = this.stage.getWidth();
      else if (this.x > this.stage.getWidth()) this.x = 0;

      if (this.y < 0) this.y = this.stage.getHeight();
      else if (this.y > this.stage.getHeight()) this.y = 0;

      // Spore burst emission
      const sporeFreq = this.stage.viz.config.sporeFrequency || 0;
      const sporeChance = this.stage.viz.config.sporeChance || 0;
      // Only emit if this node's roll is within the chance percentage
      if (sporeFreq > 0 && this.sporeRoll < sporeChance) {
        this.timeSinceLastBurst += delta * 5;  // Speed up accumulation
        // Burst every 0.5-2 seconds depending on frequency
        const burstInterval = 0.5 / sporeFreq;
        if (this.timeSinceLastBurst >= burstInterval) {
          this.emitSpores();
          this.timeSinceLastBurst = 0;
        }
      }

      this.redraw();
    }

    redraw() {
      if (!this.graphics) return;

      const themeColors = this.stage.viz.themeColors;
      const config = this.stage.viz.config;
      const avgGain = this.stage.viz.waveform.averageGain;
      const avgGainFirst = this.stage.viz.waveform.averageGainFirstOrder;

      // Use theme colors when audio is active, otherwise grayscale
      let avg = 0.5 + Math.min(8, 64 * avgGain) / 16;
      let value = Math.floor(avg * 0xFF);
      let grayscale = (value << 16) | (value << 8) | value;

      // Get theme color based on node's random color index for variety
      const colorOptions = themeColors
        ? [themeColors.primary, themeColors.secondary, themeColors.accent]
        : [this.color, this.color, this.color];
      let activeColor = colorOptions[this.colorIndex % colorOptions.length];

      // Apply hue shift if color variation is enabled
      if (config.colorVariation && themeColors) {
        activeColor = shiftHue(activeColor, this.hueOffset);
      }

      this.graphics.clear();

      // Aura effect
      const auraRadius = (this.radius + avgGainFirst * 4) * 6 * (1 - Math.exp(-3 * avgGain));
      this.graphics.lineStyle(4, avgGain > 0.15 ? activeColor : grayscale, 0.3);
      this.graphics.drawCircle(0, 0, auraRadius);

      // Node core
      this.graphics.lineStyle(0);
      this.graphics.beginFill(avgGain > 0.15 ? activeColor : grayscale);
      this.graphics.drawCircle(0, 0, this.radius + avgGainFirst * 4);
      this.graphics.endFill();
    }

    getCurrentColor() {
      const themeColors = this.stage.viz.themeColors;
      const config = this.stage.viz.config;
      const colorOptions = themeColors
        ? [themeColors.primary, themeColors.secondary, themeColors.accent]
        : [this.color, this.color, this.color];
      let activeColor = colorOptions[this.colorIndex % colorOptions.length];
      if (config.colorVariation && themeColors) {
        activeColor = shiftHue(activeColor, this.hueOffset);
      }
      return activeColor;
    }

    emitSpores() {
      const container = this.stage.sporeContainer;
      if (!container) return;
      const color = this.getCurrentColor();
      const count = 5 + Math.floor(Math.random() * 8);  // 5-12 particles
      const fadeTime = this.stage.viz.config.sporeFadeTime || 1.5;
      container.burst(this.position.x, this.position.y, color, count, fadeTime);
    }
  }

  // ================================================================
  // SporeParticle - Tiny particles emitted from nodes
  // ================================================================
  class SporeParticle extends DisplayObject {
    constructor(stage, x, y, color, fadeTime) {
      super(stage);
      this.position.set(x, y);
      this.color = color;
      this.radius = 2 + Math.random() * 3;  // Small: 2-5px
      this.life = 1.0;  // Full life
      // Decay rate based on fade time (with some variation)
      const baseDecay = 1 / (fadeTime || 1.5);
      this.decay = baseDecay * (0.8 + Math.random() * 0.4);  // +/- 20% variation

      // Random outward velocity
      const angle = Math.random() * Math.PI * 2;
      const speed = 30 + Math.random() * 50;
      this.velocity.set(Math.cos(angle) * speed, Math.sin(angle) * speed);
      this.setFriction(1.5);  // Gradual slowdown
    }

    update(delta) {
      super.update(delta);
      this.life -= delta * this.decay;
      if (this.life <= 0) {
        this.parent?.removeChild(this);
        return;
      }
      this.redraw();
    }

    redraw() {
      if (!this.graphics) return;
      this.graphics.clear();
      // Bright core
      this.graphics.beginFill(this.color, this.life);
      this.graphics.drawCircle(0, 0, this.radius);
      this.graphics.endFill();
      // Soft glow
      this.graphics.beginFill(this.color, this.life * 0.3);
      this.graphics.drawCircle(0, 0, this.radius * 2);
      this.graphics.endFill();
    }
  }

  // ================================================================
  // SporeContainer - Manages all active spore particles
  // ================================================================
  class SporeContainer extends DisplayObjectContainer {
    constructor(stage) {
      super(stage);
    }

    addSpore(x, y, color, fadeTime) {
      const spore = new SporeParticle(this.stage, x, y, color, fadeTime);
      this.addChild(spore);
    }

    burst(x, y, color, count, fadeTime) {
      for (let i = 0; i < count; i++) {
        this.addSpore(x, y, color, fadeTime);
      }
    }
  }

  // ================================================================
  // NodeLinker - Connection lines between nodes and creature
  // ================================================================
  class NodeLinker extends DisplayObject {
    constructor(stage, nodes) {
      super(stage);
      this.nodeParent = nodes;
      this.centerPosition = new PIXI.Point(0, 0);
    }

    update(delta) {
      super.update(delta);

      const N = this.nodeParent.children.length;
      const nodeContainer = this.parent;
      this.centerPosition.x = nodeContainer.circle.position.x;
      this.centerPosition.y = nodeContainer.circle.position.y;

      // Apply forces between nodes
      for (let i = 0; i < N; i++) {
        const node = this.nodeParent.children[i];

        // Force toward center
        const angle = Math.atan2(
          node.position.y - this.centerPosition.y,
          node.position.x - this.centerPosition.x
        );
        const dist = Point.distance(node.position, this.centerPosition);
        const fx = -Math.cos(angle) * 100000 / dist;
        const fy = -Math.sin(angle) * 100000 / dist;
        node.setForce('tocenter', { x: fx, y: fy });

        // Repulsion between nodes
        for (let k = i + 1; k < N; k++) {
          const otherNode = this.nodeParent.children[k];
          const nodeDist = Point.distance(node.position, otherNode.position);

          if (nodeDist > 300) {
            node.clearForce('node_' + otherNode.id);
            otherNode.clearForce('node_' + node.id);
            continue;
          }

          const a = Math.atan2(
            node.position.y - otherNode.position.y,
            node.position.x - otherNode.position.x
          );
          let rfx = 0, rfy = 0;
          if (nodeDist !== 0) {
            rfx = Math.cos(a) * 10000 / nodeDist;
            rfy = Math.sin(a) * 10000 / nodeDist;
          }

          node.setForce('node_' + otherNode.id, new PIXI.Point(-rfx, -rfy));
          otherNode.setForce('node_' + node.id, new PIXI.Point(rfx, rfy));
        }
      }

      this.redraw();
    }

    redraw() {
      if (!this.graphics) return;

      const themeColors = this.stage.viz.themeColors;
      const config = this.stage.viz.config;
      const lineColor = themeColors ? themeColors.secondary : 0xFFFFFF;

      this.graphics.clear();
      this.graphics.lineStyle(1.5, lineColor, config.lineOpacity);

      const N = this.nodeParent.children.length;
      for (let i = 0; i < N; i++) {
        const node = this.nodeParent.children[i];
        const distance = Point.distance(node.position, this.centerPosition);

        // Draw lines for nodes within 3x creature radius
        if (distance > this.parent.circle.radius * 3) continue;

        // Draw line from node to center
        this.graphics.moveTo(node.position.x, node.position.y);
        this.graphics.lineTo(this.centerPosition.x, this.centerPosition.y);
      }
    }
  }

  // ================================================================
  // NodeContainer
  // ================================================================
  class NodeContainer extends DisplayObjectContainer {
    constructor(stage, circle) {
      super(stage);

      this.circle = circle;
      this.nodes = new DisplayObjectContainer(this.stage);
      this.addChild(this.nodes);
      this.addChildAt(new NodeLinker(this.stage, this.nodes), 0);
    }

    populate() {
      const targetCount = this.stage.viz.config.nodeCount;
      const width = this.stage.getWidth();
      const height = this.stage.getHeight();

      for (let i = 0; i < targetCount; i++) {
        const x = Math.random() * width;
        const y = Math.random() * height;
        this.addNode(x, y, 0, 0);
      }
    }

    addNode(x, y, vx, vy) {
      const node = new Node(this.stage);
      node.position.set(x, y);
      node.velocity.set(vx, vy);
      this.nodes.addChild(node);
    }

    setNodeCount(count) {
      const current = this.nodes.children.length;
      const width = this.stage.getWidth();
      const height = this.stage.getHeight();

      if (count > current) {
        // Add more nodes
        for (let i = current; i < count; i++) {
          this.addNode(Math.random() * width, Math.random() * height, 0, 0);
        }
      } else if (count < current) {
        // Remove excess nodes
        while (this.nodes.children.length > count) {
          const node = this.nodes.children[this.nodes.children.length - 1];
          this.nodes.removeChild(node);
        }
      }
    }
  }

  // ================================================================
  // PowerCircle - The cute creature!
  // ================================================================
  class PowerCircle extends DisplayObject {
    constructor(stage, baseRadius, centerX, centerY) {
      super(stage);

      this.baseRadius = baseRadius;
      this.centerX = centerX;
      this.centerY = centerY;
      this.radius = baseRadius;

      this.lineWidth = 1;
      this.eyesClosed = false;
      this.targetPosition = new PIXI.Point(0, 0);
      this.rotationAcceleration = 0;
      this.rotationVelocity = 0;
      this.targetRotation = 0;
      this.targetBaseRotation = 0;
      this.lastUpdateRandomPosition = 0;
      this.lastUpdateRandomRotation = 0;
      this.randomAngle = 0;

      // Eye tracking - pupils follow mouse cursor
      this.eyeOffsetX = 0;
      this.eyeOffsetY = 0;
      this.mouseX = 0;
      this.mouseY = 0;

      // Petting detection and reaction
      this.isPetting = false;
      this.petIntensity = 0;        // 0-1, builds up while being petted
      this.lastPetMouseX = 0;
      this.lastPetMouseY = 0;
      this.petParticleTimer = 0;

      // Tossing/dragging state
      this.isDragging = false;
      this.isTossed = false;
      this.tossVelocityX = 0;
      this.tossVelocityY = 0;
      this.dragOffsetX = 0;
      this.dragOffsetY = 0;
      this.dragHistory = []; // Track recent positions for velocity calculation

      // Sleep/wake state
      this.isSleeping = false;      // Start awake
      this.sleepiness = 0;          // 0-1, builds up during inactivity
      this.sleepTransition = 0;     // No sleep visuals initially
      this.lastInteractionTime = Date.now();
      this.sleepBreathPhase = 0;    // For gentle breathing animation
      this.sleepZs = [];            // Floating Zs when sleeping
      this.lastZTime = 0;           // Timer for spawning Zs

      // Separate graphics for Zs (unfiltered, sharp)
      this.zGraphics = new PIXI.Graphics();

      // Blur filter for soft glow
      this.filter = new PIXI.filters.BlurFilter();
      this.filters = [this.filter];

      this.setFriction(1);
      this.position.x = centerX;
      this.position.y = centerY;
    }

    setBaseRadius(baseRadius) {
      this.baseRadius = baseRadius;
    }

    setCenter(x, y) {
      this.centerX = x;
      this.centerY = y;
    }

    setScale(scale) {
      // Scale the creature
      this.scale.set(scale, scale);
    }

    update(delta) {
      super.update(delta);

      const waveform = this.stage.viz.waveform;

      // Blink eyes periodically (100ms blink every 3 seconds)
      // When sleeping, eyes stay closed
      if (this.isSleeping || this.sleepTransition > 0.5) {
        this.eyesClosed = true;
      } else {
        this.eyesClosed = Math.floor(10 * Date.now() / 1000) % 30 === 0;
      }

      // Audio-reactive line width
      this.lineWidth = 1 + waveform.averageGainLinearized * 8;

      // Blur decreases with audio intensity
      this.filter.blur = Math.floor(0.2 + 4 * Math.exp(-24 * waveform.averageGainLinearized));

      // Radius expands with audio
      this.radius = this.baseRadius + 100 * waveform.averageGainLinearized;

      // Movement force toward target
      this.setForce('main', {
        x: (this.targetPosition.x - this.position.x) * waveform.averageGainFirstOrder * 16,
        y: (this.targetPosition.y - this.position.y) * waveform.averageGainFirstOrder * 16
      });

      // Update random position direction
      if (Date.now() > 800 + this.lastUpdateRandomPosition) {
        this.randomAngle = Math.random() * 2 * Math.PI;
        this.lastUpdateRandomPosition = Date.now();
      }

      // Update rotation
      if (Date.now() > 1400 + this.lastUpdateRandomRotation) {
        this.targetRotation = waveform.averageGainFirstOrder * 2 * (Math.random() - 0.5);

        // Random spin when audio is loud enough
        if (Math.random() < 0.05 && waveform.averageGainFirstOrder >= 0.25) {
          this.targetBaseRotation -= Math.PI * 2;
        }
        this.lastUpdateRandomRotation = Date.now();
      }

      // Apply rotation physics
      this.rotationAcceleration = (this.targetRotation + this.targetBaseRotation - this.rotation) * waveform.averageGainFirstOrder * 16;
      this.rotationAcceleration += -this.rotationVelocity * 2;
      this.rotationVelocity += this.rotationAcceleration * delta;
      this.rotation += this.rotationVelocity * delta;

      // Eye tracking - calculate pupil offset toward mouse
      this.updateEyeTracking(delta);

      // Petting detection and reaction
      this.updatePetting(delta);

      // Handle toss physics (if being tossed)
      this.updateToss(delta);

      // Sleep/wake state management
      this.updateSleep(delta);

      // Only update normal position if not being dragged or tossed
      if (!this.isDragging && !this.isTossed) {
        this.updatePosition();
      }

      this.redraw();
    }

    updatePosition() {
      const waveform = this.stage.viz.waveform;
      const radius = waveform.averageGainFirstOrder * 256;
      const x = Math.cos(this.randomAngle) * radius;
      const y = Math.sin(this.randomAngle) * radius;

      // Mouse attraction (if available)
      let mouseVectorX = 0, mouseVectorY = 0;
      if (this.stage.renderer && this.stage.renderer.plugins && this.stage.renderer.plugins.interaction) {
        const mousePos = this.stage.renderer.plugins.interaction.mouse.global;
        const mouseVectorLength = Math.min(radius, Point.distance(mousePos, this.position));
        const mouseAngle = Math.atan2(
          mousePos.y - this.position.y,
          mousePos.x - this.position.x
        );
        mouseVectorX = Math.cos(mouseAngle) * mouseVectorLength;
        mouseVectorY = Math.sin(mouseAngle) * mouseVectorLength;
      }

      this.targetPosition.x = this.centerX + x + mouseVectorX;
      this.targetPosition.y = this.centerY + y + mouseVectorY;
    }

    updateEyeTracking(delta) {
      // Try to get updated mouse position from PIXI renderer
      if (this.stage.renderer && this.stage.renderer.plugins && this.stage.renderer.plugins.interaction) {
        const mousePos = this.stage.renderer.plugins.interaction.mouse.global;
        this.mouseX = mousePos.x;
        this.mouseY = mousePos.y;
      }

      // Always recalculate offset based on stored mouse position and current rotation
      // This ensures eyes track correctly even when creature rotates with mouse stationary
      let targetOffsetX = 0;
      let targetOffsetY = 0;

      // Calculate direction from creature center to mouse (in world space)
      const dx = this.mouseX - this.position.x;
      const dy = this.mouseY - this.position.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance > 0) {
        // Rotate direction into creature's local space (compensate for rotation)
        const cos = Math.cos(-this.rotation);
        const sin = Math.sin(-this.rotation);
        const localDx = dx * cos - dy * sin;
        const localDy = dx * sin + dy * cos;

        // Normalize and scale - max pupil offset is 30% of eye size
        const maxOffset = this.radius * 0.03;
        // Pupils move more when mouse is closer (within 3x radius)
        const influence = Math.min(1, (this.radius * 3) / Math.max(distance, 1));

        targetOffsetX = (localDx / distance) * maxOffset * influence;
        targetOffsetY = (localDy / distance) * maxOffset * influence;
      }

      // Smooth eye movement (pupils don't snap instantly)
      const smoothing = 8 * delta;
      this.eyeOffsetX += (targetOffsetX - this.eyeOffsetX) * Math.min(1, smoothing);
      this.eyeOffsetY += (targetOffsetY - this.eyeOffsetY) * Math.min(1, smoothing);
    }

    updatePetting(delta) {
      // Check if mouse is over the creature and moving
      const dx = this.mouseX - this.position.x;
      const dy = this.mouseY - this.position.y;
      const distanceToMouse = Math.sqrt(dx * dx + dy * dy);

      // Mouse movement since last frame
      const mouseMoveX = this.mouseX - this.lastPetMouseX;
      const mouseMoveY = this.mouseY - this.lastPetMouseY;
      const mouseSpeed = Math.sqrt(mouseMoveX * mouseMoveX + mouseMoveY * mouseMoveY);

      // Store current mouse position for next frame
      this.lastPetMouseX = this.mouseX;
      this.lastPetMouseY = this.mouseY;

      // Petting = mouse is over creature (within 1.5x radius) AND moving
      const isOverCreature = distanceToMouse < this.radius * 1.5;
      // Filter out teleports (initial position jump from 0,0) and require minimum movement
      const isMouseMoving = mouseSpeed > 2 && mouseSpeed < 100;

      if (isOverCreature && isMouseMoving) {
        // Being petted! Build up intensity
        this.isPetting = true;
        this.petIntensity = Math.min(1, this.petIntensity + delta * 3);

        // Emit happy particles while petting
        this.petParticleTimer += delta;
        if (this.petParticleTimer > 0.15 && this.petIntensity > 0.3) {
          this.emitPetParticle();
          this.petParticleTimer = 0;
        }
      } else {
        // Not being petted, decay intensity
        this.isPetting = false;
        this.petIntensity = Math.max(0, this.petIntensity - delta * 2);
        this.petParticleTimer = 0;
      }
    }

    emitPetParticle() {
      // Emit a happy particle from the creature's surface
      const container = this.stage.sporeContainer;
      if (!container) return;

      const themeColors = this.stage.viz.themeColors;
      // Use a warm/happy color (accent or shifted toward pink/orange)
      const color = themeColors ? themeColors.accent : 0xFFAAAA;

      // Random position on creature's surface
      const angle = Math.random() * Math.PI * 2;
      const x = this.position.x + Math.cos(angle) * this.radius * 0.8;
      const y = this.position.y + Math.sin(angle) * this.radius * 0.8;

      container.burst(x, y, color, 3, 0.8); // Small burst of 3 particles
    }

    redraw() {
      if (!this.graphics) return;

      const themeColors = this.stage.viz.themeColors;
      const config = this.stage.viz.config;
      const primaryColor = themeColors ? themeColors.primary : 0xFFFFFF;
      const accentColor = themeColors ? themeColors.accent : 0xFFFFFF;
      const faceColor = 0x111111; // Keep dark for contrast

      this.graphics.clear();

      // Draw waveform spikes
      const wave = this.stage.viz.waveform.timeDomainDataSmooth;
      const waveAverage = wave.reduce((acc, v) => acc + v, 0) / wave.length;
      const waveMinimum = wave.reduce((acc, v) => Math.min(acc, v), wave[0]);
      // Apply spike height multiplier from config
      const maxAmplitude = this.radius * config.spikeHeight;

      // Calculate points for both waveform layers
      const points = [];
      const points2 = [];

      for (let i = 0, angle = Math.PI / 2 - 0.5 * Math.PI / wave.length; i < wave.length; i++, angle += Math.PI / wave.length) {
        const amplitude = Math.max(0, wave[i] - waveMinimum);
        const x = Math.cos(angle) * (this.radius + maxAmplitude * amplitude);
        const y = Math.sin(angle) * (this.radius + maxAmplitude * amplitude);

        const amplitude2 = Math.max(0, wave[i] - waveAverage);
        const x2 = Math.cos(angle) * (5 + this.radius + maxAmplitude * amplitude2);
        const y2 = Math.sin(angle) * (5 + this.radius + maxAmplitude * amplitude2);

        points.push({ x, y });
        points2.push({ x: x2, y: y2 });
      }

      // Mirror points for full circle
      for (let i = points.length - 1; i >= 0; i--) {
        points.push({ x: -points[i].x, y: points[i].y });
        points2.push({ x: -points2[i].x, y: points2[i].y });
      }

      // Draw outer waveform (thin, semi-transparent) - use accent color
      this.graphics.beginFill(accentColor, 0.02);
      this.graphics.lineStyle(this.lineWidth, accentColor, 0.2);
      this.graphics.moveTo(points[0].x, points[0].y);
      for (const point of points) {
        this.graphics.lineTo(point.x, point.y);
      }

      // Draw inner waveform (thicker, more prominent) - use primary color
      this.graphics.beginFill(primaryColor, 0.2);
      this.graphics.lineStyle(this.lineWidth, primaryColor, 1);
      this.graphics.moveTo(points2[0].x, points2[0].y);
      for (const point of points2) {
        this.graphics.lineTo(point.x, point.y);
      }

      // Draw dark face disk
      this.graphics.beginFill(faceColor, 1);
      this.graphics.lineStyle(this.lineWidth, primaryColor);
      this.graphics.drawCircle(0, 0, this.radius);
      this.graphics.endFill();

      // Draw face outline
      this.graphics.lineStyle(this.lineWidth, primaryColor);
      this.graphics.drawCircle(0, 0, this.radius);

      // Petting glow effect - warm halo when being petted
      if (this.petIntensity > 0) {
        const glowAlpha = this.petIntensity * 0.3;
        const glowRadius = this.radius * (1.1 + this.petIntensity * 0.2);
        this.graphics.lineStyle(0);
        this.graphics.beginFill(accentColor, glowAlpha * 0.3);
        this.graphics.drawCircle(0, 0, glowRadius);
        this.graphics.endFill();
        // Inner warm glow
        this.graphics.beginFill(primaryColor, glowAlpha * 0.2);
        this.graphics.drawCircle(0, 0, this.radius * 1.05);
        this.graphics.endFill();
      }

      // Sleep effect - gentle breathing glow and dimming
      if (this.sleepTransition > 0) {
        // Breathing pulse - subtle rhythmic glow
        const breathIntensity = Math.sin(this.sleepBreathPhase) * 0.5 + 0.5; // 0-1
        const breathGlow = this.sleepTransition * breathIntensity * 0.15;
        const breathRadius = this.radius * (1 + breathIntensity * 0.05 * this.sleepTransition);

        // Soft sleeping aura (dimmer blue-ish tint)
        this.graphics.lineStyle(0);
        this.graphics.beginFill(0x8888FF, breathGlow);
        this.graphics.drawCircle(0, 0, breathRadius);
        this.graphics.endFill();

        // Dim overlay when sleeping (darkens the creature slightly)
        this.graphics.beginFill(0x000000, this.sleepTransition * 0.2);
        this.graphics.drawCircle(0, 0, this.radius * 0.99);
        this.graphics.endFill();
      }

      // Draw floating Zs on separate unfiltered layer (crisp, not blurry)
      this.zGraphics.clear();
      if (this.sleepZs.length > 0) {
        for (const z of this.sleepZs) {
          const size = this.radius * 0.6 * z.scale;  // Much larger
          // Position relative to creature's world position
          const worldX = this.position.x + z.x;
          const worldY = this.position.y + z.y;

          this.zGraphics.lineStyle(4, primaryColor, z.alpha);  // Thicker lines
          // Draw a bold "Z" shape
          this.zGraphics.moveTo(worldX, worldY);
          this.zGraphics.lineTo(worldX + size, worldY);
          this.zGraphics.lineTo(worldX, worldY + size);
          this.zGraphics.lineTo(worldX + size, worldY + size);
        }
      }

      // Draw eyes with tracking - entire eyes move around face
      const baseEyesY = -this.radius * 0.3;
      const baseLeftEyeX = 0;
      const baseRightEyeX = this.radius * 0.3;

      // Move entire eyes based on mouse tracking (scaled up for visibility)
      const eyeMoveScale = this.radius * 0.15; // Eyes can move 15% of radius
      const eyeOffsetX = this.eyeOffsetX * 5; // Amplify the offset
      const eyeOffsetY = this.eyeOffsetY * 5;
      const clampedEyeOffsetX = Math.max(-eyeMoveScale, Math.min(eyeMoveScale, eyeOffsetX));
      const clampedEyeOffsetY = Math.max(-eyeMoveScale, Math.min(eyeMoveScale, eyeOffsetY));

      const leftEyeX = baseLeftEyeX + clampedEyeOffsetX;
      const rightEyeX = baseRightEyeX + clampedEyeOffsetX;
      const eyesY = baseEyesY + clampedEyeOffsetY;

      if (this.eyesClosed) {
        // Closed eyes - thin horizontal lines
        const closedSize = this.radius * 0.02;
        this.graphics.lineStyle(1, primaryColor);
        this.graphics.beginFill(primaryColor, 1);
        this.graphics.drawRect(leftEyeX - closedSize * 0.5, eyesY - closedSize * 0.5, closedSize, closedSize);
        this.graphics.drawRect(rightEyeX - closedSize * 0.5, eyesY - closedSize * 0.5, closedSize, closedSize);
      } else {
        // Open eyes with pupils that also shift within the eye
        const eyeSize = this.radius * 0.1;
        const pupilSize = eyeSize * 0.5;
        const maxPupilOffset = eyeSize * 0.2; // Pupils move within eye

        // Squint when being petted (happy expression)
        const squintFactor = 1 - (this.petIntensity * 0.6); // Eyes get shorter when happy
        const eyeHeight = eyeSize * squintFactor;
        const pupilHeight = pupilSize * squintFactor;

        // Pupil offset (smaller, within-eye movement)
        const pupilOffsetX = Math.max(-maxPupilOffset, Math.min(maxPupilOffset, this.eyeOffsetX * 2));
        const pupilOffsetY = Math.max(-maxPupilOffset * squintFactor, Math.min(maxPupilOffset * squintFactor, this.eyeOffsetY * 2));

        // Draw eye sockets (outer squares) - height affected by squint
        this.graphics.lineStyle(1, primaryColor, 0.8);
        this.graphics.beginFill(primaryColor, 0.3);
        this.graphics.drawRect(leftEyeX - eyeSize * 0.5, eyesY - eyeHeight * 0.5, eyeSize, eyeHeight);
        this.graphics.drawRect(rightEyeX - eyeSize * 0.5, eyesY - eyeHeight * 0.5, eyeSize, eyeHeight);
        this.graphics.endFill();

        // Draw pupils (inner squares) - height affected by squint
        this.graphics.lineStyle(0);
        this.graphics.beginFill(primaryColor, 1);
        this.graphics.drawRect(
          leftEyeX - pupilSize * 0.5 + pupilOffsetX,
          eyesY - pupilHeight * 0.5 + pupilOffsetY,
          pupilSize, pupilHeight
        );
        this.graphics.drawRect(
          rightEyeX - pupilSize * 0.5 + pupilOffsetX,
          eyesY - pupilHeight * 0.5 + pupilOffsetY,
          pupilSize, pupilHeight
        );
        this.graphics.endFill();
      }
    }

    flip() {
      this.rotationVelocity = -Math.PI * 4;
      this.targetBaseRotation -= Math.PI * 2;
    }

    // Tossing methods
    startDrag(mouseX, mouseY) {
      // Check if click is on the creature
      const dx = mouseX - this.position.x;
      const dy = mouseY - this.position.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance < this.radius * 1.5) {
        this.isDragging = true;
        this.isTossed = false;
        this.dragOffsetX = this.position.x - mouseX;
        this.dragOffsetY = this.position.y - mouseY;
        this.dragHistory = [{ x: mouseX, y: mouseY, time: Date.now() }];
        this.tossVelocityX = 0;
        this.tossVelocityY = 0;
        // Wake up when grabbed
        this.wakeUp();
        return true;
      }
      return false;
    }

    updateDrag(mouseX, mouseY) {
      if (!this.isDragging) return;

      // Move creature with mouse
      this.position.x = mouseX + this.dragOffsetX;
      this.position.y = mouseY + this.dragOffsetY;

      // Track position history for velocity calculation (keep last 5 samples)
      const now = Date.now();
      this.dragHistory.push({ x: mouseX, y: mouseY, time: now });
      if (this.dragHistory.length > 5) {
        this.dragHistory.shift();
      }
    }

    endDrag() {
      if (!this.isDragging) return;

      this.isDragging = false;

      // Calculate throw velocity from recent drag history
      if (this.dragHistory.length >= 2) {
        const recent = this.dragHistory[this.dragHistory.length - 1];
        const older = this.dragHistory[0];
        const dt = (recent.time - older.time) / 1000; // seconds

        if (dt > 0) {
          this.tossVelocityX = (recent.x - older.x) / dt;
          this.tossVelocityY = (recent.y - older.y) / dt;

          // Only count as a toss if there's significant velocity
          const speed = Math.sqrt(this.tossVelocityX ** 2 + this.tossVelocityY ** 2);
          if (speed > 50) {
            this.isTossed = true;
            // Cap max velocity
            const maxVel = 800;
            if (speed > maxVel) {
              this.tossVelocityX = (this.tossVelocityX / speed) * maxVel;
              this.tossVelocityY = (this.tossVelocityY / speed) * maxVel;
            }
          }
        }
      }

      this.dragHistory = [];
    }

    updateToss(delta) {
      if (!this.isTossed) return;

      // Apply velocity
      this.position.x += this.tossVelocityX * delta;
      this.position.y += this.tossVelocityY * delta;

      // Bounce off boundaries
      const width = this.stage.getWidth();
      const height = this.stage.getHeight();
      const margin = this.radius;

      if (this.position.x < margin) {
        this.position.x = margin;
        this.tossVelocityX *= -0.7; // Bounce with energy loss
      } else if (this.position.x > width - margin) {
        this.position.x = width - margin;
        this.tossVelocityX *= -0.7;
      }

      if (this.position.y < margin) {
        this.position.y = margin;
        this.tossVelocityY *= -0.7;
      } else if (this.position.y > height - margin) {
        this.position.y = height - margin;
        this.tossVelocityY *= -0.7;
      }

      // Apply friction to slow down
      const friction = 2.5;
      this.tossVelocityX *= Math.max(0, 1 - friction * delta);
      this.tossVelocityY *= Math.max(0, 1 - friction * delta);

      // Return to center gradually
      const centerX = this.centerX;
      const centerY = this.centerY;
      const returnForce = 30; // Gentle pull back to center
      this.tossVelocityX += (centerX - this.position.x) * returnForce * delta;
      this.tossVelocityY += (centerY - this.position.y) * returnForce * delta;

      // Stop tossing when nearly stopped and near center
      const speed = Math.sqrt(this.tossVelocityX ** 2 + this.tossVelocityY ** 2);
      const distToCenter = Math.sqrt((this.position.x - centerX) ** 2 + (this.position.y - centerY) ** 2);
      if (speed < 10 && distToCenter < 20) {
        this.isTossed = false;
        this.tossVelocityX = 0;
        this.tossVelocityY = 0;
      }
    }

    updateSleep(delta) {
      const now = Date.now();
      const timeSinceInteraction = (now - this.lastInteractionTime) / 1000;
      const waveform = this.stage.viz.waveform;

      // Check for wake-up triggers
      // Only sustained petting (intensity > 0.3) prevents sleep, not brief mouse movements
      const isInteracting = this.isDragging || this.petIntensity > 0.3;
      // Audio above threshold keeps the creature awake (not just when sleeping)
      const hasAudio = waveform.averageGainLinearized > 0.08;

      if (isInteracting || hasAudio) {
        // Stay awake / wake up
        this.lastInteractionTime = now;
        this.sleepiness = Math.max(0, this.sleepiness - delta * 3);
        if (this.isSleeping && this.sleepiness < 0.3) {
          this.isSleeping = false;
        }
      } else {
        // Build up sleepiness over time (falls asleep after ~30 seconds of silence)
        if (timeSinceInteraction > 10) {
          this.sleepiness = Math.min(1, this.sleepiness + delta * 0.04);
        }
        // Fall asleep when sleepiness is high
        if (this.sleepiness > 0.8) {
          this.isSleeping = true;
        }
      }

      // Smooth transition for sleep visuals
      const targetTransition = this.isSleeping ? 1 : 0;
      this.sleepTransition += (targetTransition - this.sleepTransition) * delta * 2;

      // Breathing animation phase while sleeping
      if (this.isSleeping) {
        this.sleepBreathPhase += delta * 0.8; // Slow breathing

        // Spawn floating Zs periodically
        this.lastZTime += delta;
        if (this.lastZTime > 0.8) { // New Z every 0.8 seconds
          this.lastZTime = 0;
          this.sleepZs.push({
            x: this.radius * 0.3,  // Start near top-right of creature
            y: -this.radius * 0.5,
            alpha: 1,
            scale: 0.5 + Math.random() * 0.3,
            age: 0
          });
        }
      }

      // Update floating Zs (even during wake transition for smooth fade)
      for (let i = this.sleepZs.length - 1; i >= 0; i--) {
        const z = this.sleepZs[i];
        z.age += delta;
        z.x += delta * 30;  // Drift right faster
        z.y -= delta * 40;  // Float up faster
        z.alpha = Math.max(0, 1 - z.age / 2.5); // Fade over 2.5 seconds
        z.scale += delta * 0.2; // Grow more noticeably

        // Remove old Zs
        if (z.alpha <= 0) {
          this.sleepZs.splice(i, 1);
        }
      }
    }

    wakeUp() {
      // Called by interactions to wake the creature
      this.lastInteractionTime = Date.now();
      this.sleepiness = 0;
      this.isSleeping = false;
    }
  }

  // ================================================================
  // Stage - Main container and renderer
  // ================================================================
  class Stage extends DisplayObjectContainer {
    constructor(canvasContainer, viz) {
      super(null);

      this.viz = viz;
      this.canvasContainer = canvasContainer;
      this.lastUpdateDelta = 0;
      this.lastDelta = 0;
      this.powerCircle = undefined;

      // Frame rate limiting - load from config or default to 30fps
      const savedConfig = localStorage.getItem('visualizer-poweraudio-config');
      let savedFps = 30;
      try {
        if (savedConfig) {
          const config = JSON.parse(savedConfig);
          savedFps = config.fps || 30;
        }
      } catch (e) {}
      this.targetFPS = savedFps;
      this.frameInterval = 1000 / this.targetFPS;
      this.lastFrameTime = 0;
      this.isPaused = false;
      this.animationId = null;

      // Create PIXI renderer with transparency and GPU preference
      this.renderer = PIXI.autoDetectRenderer({
        width: this.canvasContainer.clientWidth,
        height: this.canvasContainer.clientHeight,
        transparent: true,
        antialias: false,  // Disabled for performance
        powerPreference: 'high-performance'  // Prefer dedicated GPU
      });
      // Force canvas transparency via inline style
      this.renderer.view.style.background = 'transparent';
      this.canvasContainer.appendChild(this.renderer.view);
      this.renderer.render(this);
    }

    getWidth() {
      return this.canvasContainer.clientWidth;
    }

    getHeight() {
      return this.canvasContainer.clientHeight;
    }

    resize() {
      this.renderer.resize(this.canvasContainer.clientWidth, this.canvasContainer.clientHeight);
      if (this.powerCircle) {
        this.powerCircle.setBaseRadius(Math.min(this.getWidth(), this.getHeight()) / 12);
        this.powerCircle.setCenter(this.getWidth() / 2, 6 * this.getHeight() / 10);
      }
    }

    update() {
      // Stop loop entirely if paused or hidden (saves CPU - no more requestAnimationFrame calls)
      if (this.isPaused || document.hidden) {
        this.animationId = null;
        return;
      }

      // Schedule next frame
      this.animationId = requestAnimationFrame(this.update.bind(this));

      // Frame rate limiting - skip render if not enough time has passed
      const now = performance.now();
      if (now - this.lastFrameTime < this.frameInterval) return;
      this.lastFrameTime = now - ((now - this.lastFrameTime) % this.frameInterval);

      const currentDateMs = Date.now() / 1000;
      this.lastDelta = currentDateMs - this.lastUpdateDelta;
      this.lastUpdateDelta = currentDateMs;

      if (this.lastDelta > 1) {
        this.lastDelta = 0;
      }

      // Apply movement speed multiplier
      const adjustedDelta = this.lastDelta * this.viz.config.movementSpeed;
      super.update(adjustedDelta);
      this.renderer.render(this);
    }

    /**
     * Pause the animation loop (for when switching to different visualizer mode)
     */
    pause() {
      this.isPaused = true;
      if (this.animationId) {
        cancelAnimationFrame(this.animationId);
        this.animationId = null;
      }
    }

    /**
     * Resume the animation loop
     */
    resume() {
      if (this.isPaused) {
        this.isPaused = false;
        this.lastFrameTime = performance.now();
        this.lastUpdateDelta = Date.now() / 1000;
        if (!this.animationId) {
          this.update();
        }
      }
    }

    /**
     * Restart loop after visibility change (called from start())
     */
    _setupVisibilityListener() {
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden && !this.isPaused && !this.animationId) {
          this.lastFrameTime = performance.now();
          this.lastUpdateDelta = Date.now() / 1000;
          this.update();
        }
      });
    }

    start() {
      // Clear existing children
      while (this.children.length > 0) {
        this.removeChildAt(0);
      }

      // Create PowerCircle (the cute creature)
      this.powerCircle = new PowerCircle(
        this,
        Math.min(this.getWidth(), this.getHeight()) / 12,
        this.getWidth() / 2,
        6 * this.getHeight() / 10
      );
      this.addChild(this.powerCircle);

      // Add the Zzz graphics layer (on top, unfiltered for crisp Zs)
      this.addChild(this.powerCircle.zGraphics);

      // Create node container with particles
      this.nodeContainer = new NodeContainer(this, this.powerCircle);
      this.nodeContainer.populate();
      this.addChildAt(this.nodeContainer, 0);

      // Add spore container (on top of nodes)
      this.sporeContainer = new SporeContainer(this);
      this.addChild(this.sporeContainer);

      // Add animated background
      this.addChildAt(new AnimatedBackground(this), 0);

      // Set up tossing/dragging event listeners
      this.setupDragListeners();

      this.run();
    }

    setupDragListeners() {
      const canvas = this.renderer.view;

      canvas.addEventListener('mousedown', (e) => {
        const rect = canvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        if (this.powerCircle) {
          this.powerCircle.startDrag(mouseX, mouseY);
        }
      });

      canvas.addEventListener('mousemove', (e) => {
        const rect = canvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        if (this.powerCircle && this.powerCircle.isDragging) {
          this.powerCircle.updateDrag(mouseX, mouseY);
        }
      });

      canvas.addEventListener('mouseup', () => {
        if (this.powerCircle) {
          this.powerCircle.endDrag();
        }
      });

      canvas.addEventListener('mouseleave', () => {
        if (this.powerCircle) {
          this.powerCircle.endDrag();
        }
      });
    }

    run() {
      this.lastUpdateDelta = Date.now() / 1000;
      this.lastFrameTime = performance.now();
      this._setupVisibilityListener();
      this.animationId = requestAnimationFrame(this.update.bind(this));
    }

    destroy() {
      if (this.renderer) {
        this.renderer.destroy(true);
      }
    }
  }

  // ================================================================
  // Viz - Main entry point
  // ================================================================
  class Viz {
    constructor(options) {
      this.options = options;

      // Theme colors (can be updated dynamically)
      this.themeColors = options.themeColors || {
        primary: 0xFFFFFF,
        secondary: 0x808080,
        accent: 0xFFFFFF
      };

      // Convert hex string colors to numbers
      if (typeof this.themeColors.primary === 'string') {
        this.themeColors.primary = parseInt(this.themeColors.primary.replace('#', ''), 16);
      }
      if (typeof this.themeColors.secondary === 'string') {
        this.themeColors.secondary = parseInt(this.themeColors.secondary.replace('#', ''), 16);
      }
      if (typeof this.themeColors.accent === 'string') {
        this.themeColors.accent = parseInt(this.themeColors.accent.replace('#', ''), 16);
      }

      // Configurable settings
      this.config = {
        colorVariation: true,      // Enable multi-colored nodes with hue shifts
        sensitivity: 0.5,          // Audio sensitivity multiplier (lower = calmer)
        movementSpeed: 0.5,        // Animation speed multiplier (lower = slower)
        spikeHeight: 1.2,          // Waveform spike height multiplier
        nodeCount: 30,             // Number of floating nodes
        lineOpacity: 0.5,          // Connection line opacity
        sporeFrequency: 0.3,       // Spore burst frequency (0 = off, 0.6 = frequent)
        sporeChance: 0.3,          // Percentage of nodes that can emit spores (0-0.6)
        sporeFadeTime: 0.5,        // How long spores take to fade in seconds (0.2-0.8)
        creatureSize: 1.0          // Creature scale multiplier
      };

      // Waveform data structure
      this.waveform = {
        timeDomainData: new Float32Array(BIN_COUNT),
        timeDomainDataSmooth: new Float32Array(BIN_COUNT),
        minimumGain: 0,
        maximumGain: 0,
        averageGain: 0,
        averageGainLinearized: 0,
        averageGainFirstOrder: 0
      };

      // Get container element
      let canvasContainer;
      if (typeof options.container === 'string') {
        canvasContainer = document.querySelector(options.container);
      } else {
        canvasContainer = options.container;
      }

      if (!canvasContainer) {
        throw new Error('PowerAudio: Container not found');
      }

      // Create stage
      this.stage = new Stage(canvasContainer, this);
      this.stage.start();

      // Listen for container resize
      new ResizeObserver(() => this.onContainerResized()).observe(canvasContainer);

      this.lastUpdateDate = new Date();
    }

    /**
     * Update theme colors dynamically
     */
    setThemeColors(colors) {
      if (typeof colors.primary === 'string') {
        this.themeColors.primary = parseInt(colors.primary.replace('#', ''), 16);
      } else if (typeof colors.primary === 'number') {
        this.themeColors.primary = colors.primary;
      }

      if (typeof colors.secondary === 'string') {
        this.themeColors.secondary = parseInt(colors.secondary.replace('#', ''), 16);
      } else if (typeof colors.secondary === 'number') {
        this.themeColors.secondary = colors.secondary;
      }

      if (typeof colors.accent === 'string') {
        this.themeColors.accent = parseInt(colors.accent.replace('#', ''), 16);
      } else if (typeof colors.accent === 'number') {
        this.themeColors.accent = colors.accent;
      }
    }

    /**
     * Update a config setting
     */
    setConfig(key, value) {
      if (this.config.hasOwnProperty(key)) {
        this.config[key] = value;

        // Handle node count changes by recreating nodes
        if (key === 'nodeCount' && this.stage && this.stage.nodeContainer) {
          this.stage.nodeContainer.setNodeCount(value);
        }

        // Handle creature size changes
        if (key === 'creatureSize' && this.stage && this.stage.powerCircle) {
          this.stage.powerCircle.setScale(value);
        }
      }
    }

    /**
     * Get current config
     */
    getConfig() {
      return { ...this.config };
    }

    /**
     * Feed audio levels from external source
     */
    updateAudioLevels(bass, mid, high) {
      const rawDelta = (Date.now() - this.lastUpdateDate.getTime()) / 1000;
      this.lastUpdateDate = new Date();

      // Clamp delta to reasonable range (instead of rejecting large gaps)
      // This allows the visualizer to "catch up" after pauses
      const delta = Math.min(rawDelta, 0.1);

      // Apply sensitivity multiplier from config
      const sens = this.config.sensitivity;
      const bassAdj = bass * sens;
      const midAdj = mid * sens;
      const highAdj = high * sens;

      // Convert bass/mid/high to waveform metrics
      const avgGainRaw = (bassAdj + midAdj + highAdj) / 3;
      // Apply sqrt compression: makes volume changes less impactful
      // 70% volume -> 84% reactivity, 50% -> 71%, etc.
      const avgGain = Math.sqrt(avgGainRaw);
      this.waveform.averageGain = Math.min(1.5, avgGain);  // Cap to prevent overflow
      this.waveform.averageGainLinearized += delta * (avgGain > this.waveform.averageGainLinearized ? 1 : -1);
      this.waveform.averageGainFirstOrder += (avgGain - this.waveform.averageGainFirstOrder) * 0.5 * delta;

      // Generate synthetic waveform from levels with animation
      const time = Date.now() * 0.001;
      for (let i = 0; i < BIN_COUNT; i++) {
        const t = i / BIN_COUNT;
        // Amplified values with time-based animation for organic movement
        const value =
          Math.sin(t * Math.PI * 2 + time) * bassAdj * 1.2 +
          Math.sin(t * Math.PI * 4 + time * 2) * midAdj * 0.8 +
          Math.sin(t * Math.PI * 8 + time * 3) * highAdj * 0.5 +
          Math.random() * bassAdj * 0.3;  // Organic randomness

        if (value > this.waveform.timeDomainDataSmooth[i]) {
          this.waveform.timeDomainDataSmooth[i] = value;
        } else {
          this.waveform.timeDomainDataSmooth[i] += (value - this.waveform.timeDomainDataSmooth[i]) * 0.3 * delta;
        }
      }
    }

    onContainerResized() {
      this.stage.resize();
    }

    flip() {
      if (this.stage.powerCircle) {
        this.stage.powerCircle.flip();
      }
    }

    destroy() {
      if (this.stage) {
        this.stage.destroy();
      }
    }
  }

  // Export to global scope
  global.PowerAudio = {
    Viz: Viz
  };

})(typeof window !== 'undefined' ? window : this);
