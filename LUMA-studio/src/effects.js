// Post effects applied to a finished frame on a 2D canvas. They work the same for the
// realtime and the path-traced engine, so every new effect is one entry in EFFECTS:
//   id        settings key (number 0..1 or boolean)
//   label     Korean control label
//   kind      'range' | 'toggle'
//   apply(ctx, width, height, value, settings)   draws on top of the frame
export const EFFECTS = [
  {
    id: 'vignette', label: '비네팅', kind: 'range', min: 0, max: 1, step: .05, default: 0, hint: '가장자리를 어둡게 해 제품으로 시선을 모읍니다.',
    apply(ctx, width, height, amount) {
      if (amount <= 0) return;
      const radius = Math.hypot(width, height) / 2;
      const gradient = ctx.createRadialGradient(width / 2, height / 2, radius * (.55 - amount * .2), width / 2, height / 2, radius);
      gradient.addColorStop(0, 'rgba(0,0,0,0)');
      gradient.addColorStop(1, `rgba(0,0,0,${(amount * .85).toFixed(3)})`);
      ctx.save(); ctx.globalCompositeOperation = 'source-atop'; ctx.fillStyle = gradient; ctx.fillRect(0, 0, width, height); ctx.restore();
    },
  },
  {
    id: 'grain', label: '필름 그레인', kind: 'range', min: 0, max: 1, step: .05, default: 0, hint: '미세한 입자를 더해 사진 같은 질감을 만듭니다.',
    apply(ctx, width, height, amount) {
      if (amount <= 0) return;
      const image = ctx.getImageData(0, 0, width, height), data = image.data;
      const strength = amount * 28;
      let seed = 0x9e3779b9;
      const random = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return ((seed >>> 0) / 4294967296) - .5; };
      for (let i = 0; i < data.length; i += 4) {
        if (!data[i + 3]) continue;
        const noise = random() * strength;
        data[i] = Math.max(0, Math.min(255, data[i] + noise));
        data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + noise));
        data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + noise));
      }
      ctx.putImageData(image, 0, 0);
    },
  },
  {
    id: 'watermark', label: '워터마크', kind: 'toggle', default: false, hint: '오른쪽 아래에 브랜드 텍스트를 넣습니다.',
    apply(ctx, width, height, enabled, settings) {
      if (!enabled) return;
      const text = (settings.watermarkText || 'LUMA STUDIO').slice(0, 40).toUpperCase();
      const size = Math.max(10, Math.round(Math.min(width, height) * .022));
      ctx.save();
      ctx.font = `600 ${size}px "DM Sans", "Noto Sans KR", sans-serif`;
      ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'right';
      const letterSpacing = size * .18;
      ctx.letterSpacing = `${letterSpacing}px`;
      const x = width - size * 1.6, y = height - size * 1.4;
      ctx.lineJoin = 'round'; ctx.lineWidth = size * .18; ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.strokeText(text, x, y);
      ctx.fillStyle = 'rgba(255,255,255,.82)'; ctx.fillText(text, x, y);
      ctx.restore();
    },
  },
];

export const EFFECT_DEFAULTS = Object.fromEntries(EFFECTS.map(effect => [effect.id, effect.default]));
export function hasActiveEffects(settings = {}) { return EFFECTS.some(effect => settings[effect.id] && settings[effect.id] !== effect.default); }

// Returns a new PNG blob with the effects drawn on, or the input blob when nothing is enabled.
export async function applyEffects(blob, settings = {}) {
  if (!hasActiveEffects(settings)) return blob;
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width; canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bitmap, 0, 0);
    for (const effect of EFFECTS) effect.apply(ctx, canvas.width, canvas.height, settings[effect.id], settings);
    return await new Promise((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('효과를 적용한 PNG를 만들지 못했습니다.')), 'image/png'));
  } finally { bitmap.close(); }
}
