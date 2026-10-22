// Lighting looks. Adding a look means adding an entry here: the renderer builds its
// lights and HDR softbox environment from this data and the UI draws a card for it.
//
//   background   default backdrop colour (also the user-editable background default)
//   floor        floor colour under the product
//   ambient / environment / key / rim / fill   light intensities (multiplied by the strength slider)
//   color / rimColor                           key and rim light colours
//   shadow       directional shadow strength
//   envAmbient   base brightness of the environment map
//   softboxes    emissive panels baked into the equirectangular environment (u/v in 0..1)
//   card         how the preset card is drawn: a reference image, or a CSS gradient
export const LIGHTING_PRESETS = {
  dark: {
    en: 'CHARCOAL RIM', ko: '차콜 림 라이트', tagline: '선명한 윤곽, 깊은 그림자',
    background: '#151619', floor: '#070809', ambient: .08, environment: .50, key: 4.2, rim: 16, fill: .85, shadow: .45,
    color: 0xe9f0ff, rimColor: 0xffffff, envAmbient: .025,
    softboxes: [
      { u: .18, v: .69, w: .075, h: .13, power: 7, rgb: [1, 1, 1] },
      { u: .68, v: .64, w: .035, h: .19, power: 19, rgb: [1, 1, 1] },
      { u: .40, v: .84, w: .15, h: .045, power: 6, rgb: [1, 1, 1] },
      { u: .93, v: .59, w: .045, h: .17, power: 1.5, rgb: [.86, .92, 1] },
    ],
    card: { image: './assets/reference-dark.png', position: '50% 40%', alt: '어두운 배경에서 제품 윤곽을 비추는 역광 레퍼런스' },
  },
  light: {
    en: 'SOFT STUDIO', ko: '소프트 스튜디오', tagline: '부드럽고 깨끗한 빛',
    background: '#e7e7eb', floor: '#e7e7eb', ambient: .42, environment: 1.08, key: 8, rim: 7, fill: 5, shadow: 1,
    color: 0xffffff, rimColor: 0xf0f4ff, envAmbient: .30,
    softboxes: [
      { u: .18, v: .69, w: .075, h: .13, power: 10, rgb: [1, 1, 1] },
      { u: .68, v: .64, w: .035, h: .19, power: 8, rgb: [1, 1, 1] },
      { u: .40, v: .84, w: .15, h: .045, power: 6, rgb: [1, 1, 1] },
      { u: .93, v: .59, w: .045, h: .17, power: 5, rgb: [.86, .92, 1] },
    ],
    card: { image: './assets/reference-light.png', position: '50% 28%', alt: '밝은 스튜디오의 부드러운 조명 레퍼런스' },
  },
  amber: {
    en: 'AMBER GLOW', ko: '앰버 글로우', tagline: '따뜻한 빛의 존재감',
    background: '#170c07', floor: '#170c07', ambient: .10, environment: .40, key: 4, rim: 22, fill: 1.2, shadow: .45,
    color: 0xffede0, rimColor: 0xff6b12, envAmbient: .025,
    softboxes: [
      { u: .18, v: .69, w: .075, h: .13, power: 7, rgb: [1, 1, 1] },
      { u: .68, v: .64, w: .035, h: .19, power: 19, rgb: [1, .24, .025] },
      { u: .40, v: .84, w: .15, h: .045, power: 6, rgb: [1, 1, 1] },
      { u: .93, v: .59, w: .045, h: .17, power: 1.5, rgb: [.86, .92, 1] },
    ],
    card: { image: './assets/reference-amber.png', position: 'center 53%', alt: '주황색 역광 레퍼런스' },
  },
  steel: {
    en: 'STEEL BLUE', ko: '스틸 블루', tagline: '차가운 금속감, 테크 무드',
    background: '#0d1117', floor: '#05070b', ambient: .09, environment: .55, key: 3.6, rim: 20, fill: 1.4, shadow: .5,
    color: 0xdbe8ff, rimColor: 0x6fb6ff, envAmbient: .03,
    softboxes: [
      { u: .14, v: .66, w: .06, h: .16, power: 6, rgb: [.85, .92, 1] },
      { u: .66, v: .62, w: .03, h: .22, power: 22, rgb: [.42, .7, 1] },
      { u: .86, v: .60, w: .03, h: .2, power: 14, rgb: [.42, .7, 1] },
      { u: .42, v: .86, w: .18, h: .04, power: 5, rgb: [.9, .95, 1] },
    ],
    card: { gradient: 'radial-gradient(120% 90% at 78% 30%, #6fb6ff55 0%, transparent 55%), radial-gradient(70% 60% at 20% 100%, #1d2b44 0%, transparent 70%), linear-gradient(160deg, #141a24 0%, #0b0e14 100%)' },
  },
  ivory: {
    en: 'IVORY WARM', ko: '아이보리 웜', tagline: '따뜻한 고감도 화이트',
    background: '#f1ebe1', floor: '#f1ebe1', ambient: .46, environment: 1.0, key: 7, rim: 5, fill: 5.5, shadow: 1,
    color: 0xfff3e2, rimColor: 0xffe6c8, envAmbient: .34,
    softboxes: [
      { u: .2, v: .7, w: .09, h: .14, power: 9, rgb: [1, .96, .9] },
      { u: .7, v: .64, w: .04, h: .19, power: 7, rgb: [1, .92, .8] },
      { u: .42, v: .85, w: .17, h: .05, power: 6, rgb: [1, .97, .92] },
      { u: .94, v: .58, w: .04, h: .16, power: 4, rgb: [1, .95, .88] },
    ],
    card: { gradient: 'radial-gradient(90% 80% at 30% 20%, #fff8ee 0%, transparent 60%), radial-gradient(60% 70% at 85% 90%, #e2cdb0 0%, transparent 70%), linear-gradient(170deg, #efe6d8 0%, #d9ccb9 100%)', dark: true },
  },
};

export const PRESET_IDS = Object.keys(LIGHTING_PRESETS);
export const DEFAULT_PRESET = 'dark';
export function presetBackground(id) { return LIGHTING_PRESETS[id]?.background || LIGHTING_PRESETS[DEFAULT_PRESET].background; }
