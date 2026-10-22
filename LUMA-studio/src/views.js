// Built-in camera cuts. `direction` is the camera position relative to the product centre;
// the renderer picks the distance so the product fills the frame.
export const BUILTIN_VIEWS = [
  { id: 'hero', label: '히어로', en: 'Hero angle', icon: 'box', direction: [5, 3.3, 7] },
  { id: 'front', label: '정면', en: 'Front view', icon: 'front', direction: [0, 3.5, 10] },
  { id: 'side', label: '측면', en: 'Side profile', icon: 'side', direction: [10, 3.5, 0] },
  { id: 'back', label: '후면', en: 'Rear view', icon: 'front', direction: [0, 3.5, -10] },
  { id: 'top', label: '상단', en: 'Top view', icon: 'top', direction: [0, 10, .001], up: [0, 0, -1] },
  { id: 'detail', label: '디테일', en: 'The details', icon: 'detail', direction: [6, 3.5, 8], zoom: .56, lift: .25 },
];
export const VIEW_BY_ID = Object.fromEntries(BUILTIN_VIEWS.map(view => [view.id, view]));
