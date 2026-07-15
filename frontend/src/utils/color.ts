// Hex → RGB triplet "r g b" string for CSS variables
function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex.trim());
  if (!m) return null;
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }
  return [h * 360, s * 100, l * 100];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  h /= 360; s /= 100; l /= 100;
  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }
  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [
    Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
    Math.round(hue2rgb(p, q, h) * 255),
    Math.round(hue2rgb(p, q, h - 1 / 3) * 255),
  ];
}

// Lightness mapping for 50→900, where 500 is the source color
const STEPS: Record<number, number> = {
  50: 96, 100: 92, 200: 84, 300: 74, 400: 62,
  500: -1, // use original
  600: 42, 700: 34, 800: 26, 900: 18,
};

export function generatePalette(hex: string): Record<number, string> | null {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  const [h, s] = rgbToHsl(...rgb);
  const palette: Record<number, string> = {};
  for (const [step, lightness] of Object.entries(STEPS)) {
    const k = parseInt(step, 10);
    if (lightness === -1) {
      palette[k] = `${rgb[0]} ${rgb[1]} ${rgb[2]}`;
    } else {
      // Damp saturation for very light shades to avoid neon look
      const sat = lightness > 80 ? Math.min(s, 60) : s;
      const [r, g, b] = hslToRgb(h, sat, lightness);
      palette[k] = `${r} ${g} ${b}`;
    }
  }
  return palette;
}

export function applyPalette(hex: string | null | undefined): boolean {
  if (!hex) {
    // Reset to defaults — clear inline overrides
    const root = document.documentElement;
    [50, 100, 200, 300, 400, 500, 600, 700, 800, 900].forEach(k =>
      root.style.removeProperty(`--color-primary-${k}`)
    );
    return false;
  }
  const palette = generatePalette(hex);
  if (!palette) return false;
  const root = document.documentElement;
  for (const [k, v] of Object.entries(palette)) {
    root.style.setProperty(`--color-primary-${k}`, v);
  }
  return true;
}
