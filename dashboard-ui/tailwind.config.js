/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        bg: '#0b0f14',
        card: '#121821',
        muted: '#98a2b3',
        accent: '#7c3aed'
      }
    },
  },
  plugins: [],
}

