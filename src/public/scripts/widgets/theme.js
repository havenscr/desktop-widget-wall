/* ================================================================
   THEME MODULE
   Theme switching with 6 color schemes
   ================================================================ */

const themes = [
  { name: 'Pink/Purple', key: 'pink' },
  { name: 'Teal/Cyan', key: 'teal' },
  { name: 'Sunset Orange', key: 'sunset' },
  { name: 'Midnight Blue', key: 'midnight' },
  { name: 'Emerald Forest', key: 'emerald' },
  { name: 'Rose Berry', key: 'rose' }
];

let currentThemeIndex = 0;

function initTheme() {
  const themeToggle = document.getElementById('theme-toggle');
  if (!themeToggle) return;

  // Load saved theme
  const savedTheme = localStorage.getItem('dashboard-theme');
  if (savedTheme) {
    currentThemeIndex = themes.findIndex(t => t.key === savedTheme);
    if (currentThemeIndex === -1) currentThemeIndex = 0;
    document.body.dataset.theme = themes[currentThemeIndex].key;
  }

  themeToggle.dataset.themeName = themes[currentThemeIndex].name;

  themeToggle.addEventListener('click', () => {
    currentThemeIndex = (currentThemeIndex + 1) % themes.length;
    const theme = themes[currentThemeIndex];

    document.body.dataset.theme = theme.key;
    themeToggle.dataset.themeName = theme.name;
    localStorage.setItem('dashboard-theme', theme.key);

    // Show tooltip animation
    themeToggle.classList.remove('tooltip-fading');
    themeToggle.classList.add('tooltip-visible');
    void themeToggle.offsetWidth;
    themeToggle.classList.add('tooltip-fading');

    setTimeout(() => {
      themeToggle.classList.remove('tooltip-visible', 'tooltip-fading');
    }, 2000);
  });
}

// Auto-initialize
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initTheme);
} else {
  initTheme();
}
