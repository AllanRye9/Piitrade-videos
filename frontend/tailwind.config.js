/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Matches yotweek.com's own theme colour (#F55906) so the
        // video companion reads as the same product as the
        // marketplace it refers viewers to.
        brand: {
          orange: '#F55906',
          amber: '#FFB347',
        },
      },
      // Loaded via index.html's Google Fonts link — previously declared
      // as the intended brand typeface but never actually wired up
      // anywhere, so every screen was silently rendering in each
      // browser's plain default system font instead. Tailwind's base
      // layer applies this to `html` automatically (see @tailwind base
      // in styles/index.css), so this one change applies everywhere at
      // once with no per-component work needed. Fallback stack keeps
      // the app looking reasonable for the moment before the webfont
      // loads (display=swap) or if it fails to load at all.
      fontFamily: {
        sans: ['Manrope', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
