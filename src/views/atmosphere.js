// 記録ページの背景。グラデーションと、動きを控えめにした粒子を描く。
import { moodGradient } from '../lib/mood.js';

const SETTINGS = {
  stars: { count: 70, color: '255,255,255', size: [0.5, 1.6], vy: 0, vx: 0, twinkle: true },
  bokeh: { count: 16, color: '255,214,150', size: [6, 18], vy: -0.04, vx: 0.02, twinkle: true, soft: true },
  snow: { count: 45, color: '255,255,255', size: [1, 2.8], vy: 0.35, vx: 0.1 },
  petals: { count: 22, color: '255,190,210', size: [2.5, 4.5], vy: 0.35, vx: 0.28, oval: true },
  leaves: { count: 16, color: '214,120,58', size: [3, 5], vy: 0.38, vx: 0.2, oval: true },
  bubbles: { count: 20, color: '200,240,255', size: [1.5, 5], vy: -0.3, vx: 0.05, ring: true },
  sparkle: { count: 24, color: '255,255,255', size: [0.8, 2], vy: 0, vx: 0.04, twinkle: true, lower: true },
};

let frame = null;

function stopParticles() {
  if (frame) cancelAnimationFrame(frame);
  frame = null;
  const canvas = document.getElementById('particles');
  canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
}

function startParticles(kind) {
  const setting = SETTINGS[kind];
  if (!setting) return;
  const canvas = document.getElementById('particles');
  const ctx = canvas.getContext('2d');
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const resize = () => {
    canvas.width = window.innerWidth * ratio;
    canvas.height = window.innerHeight * ratio;
  };
  resize();
  const width = () => canvas.width / ratio;
  const height = () => canvas.height / ratio;
  const random = (low, high) => low + Math.random() * (high - low);
  const particles = Array.from({ length: setting.count }, () => ({
    x: random(0, width()),
    y: setting.lower ? random(height() * 0.55, height()) : random(0, height()),
    size: random(...setting.size),
    phase: random(0, Math.PI * 2),
    drift: random(0.5, 1.2),
    tilt: random(0, Math.PI),
  }));

  const draw = (now) => {
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, width(), height());
    for (const p of particles) {
      p.x += setting.vx * p.drift + Math.sin(now / 1600 + p.phase) * Math.abs(setting.vx);
      p.y += setting.vy * p.drift;
      if (p.y > height() + 10) p.y = -10;
      if (p.y < -10) p.y = height() + 10;
      if (p.x > width() + 10) p.x = -10;
      if (p.x < -10) p.x = width() + 10;
      const alpha = setting.twinkle ? 0.3 + 0.5 * Math.abs(Math.sin(now / 1500 + p.phase)) : 0.7;
      ctx.beginPath();
      if (setting.oval) {
        ctx.ellipse(p.x, p.y, p.size, p.size * 0.55, p.tilt + now / 2000, 0, Math.PI * 2);
      } else {
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      }
      if (setting.ring) {
        ctx.strokeStyle = `rgba(${setting.color},0.5)`;
        ctx.lineWidth = 0.8;
        ctx.stroke();
      } else if (setting.soft) {
        const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size);
        glow.addColorStop(0, `rgba(${setting.color},${alpha * 0.5})`);
        glow.addColorStop(1, `rgba(${setting.color},0)`);
        ctx.fillStyle = glow;
        ctx.fill();
      } else {
        ctx.fillStyle = `rgba(${setting.color},${alpha})`;
        ctx.fill();
      }
    }
  };

  // 動きを減らす設定の端末では、静止した1枚だけを描く。
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    draw(0);
    return;
  }
  const loop = (now) => {
    draw(now);
    frame = requestAnimationFrame(loop);
  };
  frame = requestAnimationFrame(loop);
}

export function applyMood(mood) {
  document.getElementById('mood-layer').style.background = moodGradient(mood);
  document.body.dataset.ink = mood.ink;
  document.body.classList.add('has-mood');
  document.body.classList.toggle('has-wave', Boolean(mood.wave));
  stopParticles();
  startParticles(mood.particle);
}

export function clearMood() {
  document.getElementById('mood-layer').style.background = '';
  delete document.body.dataset.ink;
  document.body.classList.remove('has-mood', 'has-wave');
  stopParticles();
}
