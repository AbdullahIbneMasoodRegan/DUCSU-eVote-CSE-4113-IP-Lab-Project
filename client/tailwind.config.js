/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // WCAG AA on white: brand-700 (#0f5132-ish green) and brand-800 pass for normal text.
        brand: {
          50: '#eefaf3',
          100: '#d5f2e1',
          600: '#157347',
          700: '#0f5c39',
          800: '#0b472c',
        },
      },
      fontFamily: {
        sans: ['"Hind Siliguri"', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
