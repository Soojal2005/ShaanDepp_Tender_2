/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        navy: { 900: '#0B2545', 700: '#134074' },
        brand: { blue: '#0666F5' }
      }
    }
  },
  plugins: []
};
