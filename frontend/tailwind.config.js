/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          pink: '#fe2c55',
          cyan: '#25f4ee',
        },
      },
    },
  },
  plugins: [],
};
