export type ThemePref = "system" | "light" | "dark";

declare global {
  interface Window {
    applyTheme: (pref?: ThemePref) => void;
  }
}

// Runs in <head> before first paint: defines window.applyTheme, applies the saved theme, and marks the page as scripted.
export const themeScript = `
window.applyTheme = (pref = localStorage.getItem('theme') || 'system') => {
  const dark = pref === 'dark' || (pref === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
  document.documentElement.dataset.pref = pref;
};
applyTheme();
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyTheme());
document.documentElement.classList.add('js');
`;
