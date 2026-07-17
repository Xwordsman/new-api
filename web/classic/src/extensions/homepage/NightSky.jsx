/*
Copyright (C) 2025 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import React, { useEffect, useRef } from 'react';

const NightSky = () => {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const context = canvas.getContext('2d');
    if (!context) return undefined;

    let seed = 70421;
    const random = () => {
      seed = (seed * 16807) % 2147483647;
      return (seed - 1) / 2147483646;
    };
    const stars = Array.from({ length: 150 }, () => ({
      x: random(),
      y: random() * 0.76,
      size: random() > 0.88 ? 1.8 : 0.8 + random() * 0.7,
      alpha: 0.25 + random() * 0.65,
      phase: random() * Math.PI * 2,
      speed: 0.0004 + random() * 0.0007,
    }));
    const constellation = [12, 34, 51, 73, 108, 129];
    const reduceMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches;
    let animationFrame = 0;
    let width = 0;
    let height = 0;
    let pixelRatio = 1;

    const resize = () => {
      const bounds = canvas.getBoundingClientRect();
      width = Math.max(1, bounds.width);
      height = Math.max(1, bounds.height);
      pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * pixelRatio);
      canvas.height = Math.round(height * pixelRatio);
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    };

    const draw = (time) => {
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      context.fillStyle = '#061018';
      context.fillRect(0, 0, width, height);

      for (const star of stars) {
        const twinkle = reduceMotion
          ? 0
          : Math.sin(time * star.speed + star.phase) * 0.18;
        context.fillStyle = `rgba(226, 241, 244, ${Math.max(0.12, star.alpha + twinkle)})`;
        context.fillRect(
          Math.round(star.x * width),
          Math.round(star.y * height),
          star.size,
          star.size,
        );
      }

      context.strokeStyle = 'rgba(125, 211, 252, 0.22)';
      context.lineWidth = 0.7;
      context.beginPath();
      constellation.forEach((index, position) => {
        const star = stars[index];
        const x = star.x * width;
        const y = star.y * height;
        if (position === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      });
      context.stroke();

      context.fillStyle = '#10242b';
      context.beginPath();
      context.moveTo(0, height);
      context.lineTo(0, height * 0.78);
      context.lineTo(width * 0.16, height * 0.7);
      context.lineTo(width * 0.3, height * 0.8);
      context.lineTo(width * 0.48, height * 0.65);
      context.lineTo(width * 0.68, height * 0.79);
      context.lineTo(width * 0.84, height * 0.68);
      context.lineTo(width, height * 0.76);
      context.lineTo(width, height);
      context.closePath();
      context.fill();

      context.fillStyle = '#09171d';
      context.beginPath();
      context.moveTo(0, height);
      context.lineTo(0, height * 0.86);
      context.lineTo(width * 0.22, height * 0.76);
      context.lineTo(width * 0.4, height * 0.88);
      context.lineTo(width * 0.63, height * 0.74);
      context.lineTo(width * 0.8, height * 0.84);
      context.lineTo(width, height * 0.79);
      context.lineTo(width, height);
      context.closePath();
      context.fill();

      if (!reduceMotion) {
        const meteorProgress = (time % 9000) / 9000;
        if (meteorProgress < 0.24) {
          const progress = meteorProgress / 0.24;
          const x = width * (0.82 - progress * 0.34);
          const y = height * (0.14 + progress * 0.2);
          context.strokeStyle = 'rgba(207, 250, 254, 0.7)';
          context.lineWidth = 1;
          context.beginPath();
          context.moveTo(x, y);
          context.lineTo(x + width * 0.06, y - height * 0.035);
          context.stroke();
        }
      }

      if (!reduceMotion) animationFrame = window.requestAnimationFrame(draw);
    };

    const observer = new ResizeObserver(() => {
      resize();
      if (reduceMotion) draw(0);
    });
    observer.observe(canvas);
    resize();
    draw(0);

    return () => {
      observer.disconnect();
      window.cancelAnimationFrame(animationFrame);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden='true'
      className='pointer-events-none absolute inset-0 h-full w-full'
    />
  );
};

export default NightSky;
