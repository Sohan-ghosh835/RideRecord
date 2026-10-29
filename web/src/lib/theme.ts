export type Theme = 'light' | 'dark';

export const currentTheme = (): Theme => (document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light');

/** Switch theme with a short colour cross-fade, remember the choice on this device, and update the browser bar colour. */
export function setTheme(t: Theme) {
  const root = document.documentElement;
  root.classList.add('theme-fade');
  root.setAttribute('data-theme', t);
  try { localStorage.setItem('rr-theme', t); } catch { /* private mode: the choice just isn't remembered */ }
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', t === 'dark' ? '#000000' : '#ffffff');
  window.setTimeout(() => root.classList.remove('theme-fade'), 500);
}
