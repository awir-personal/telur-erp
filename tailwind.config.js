/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // Skala LENGKAP 50-950 (pelajaran dari app lain: stop yang tidak ada = kelas dark:* tidak pernah dibuat).
        // Amber / kuning telur: sama dengan app Distributor Telur lama, beda jelas dari biru (Keuangan),
        // teal (Gaji ART), dan cyan (Biaya Utilitas).
        brand: {
          50: '#fffbeb', 100: '#fef3c7', 200: '#fde68a', 300: '#fcd34d', 400: '#fbbf24', 500: '#f59e0b',
          600: '#d97706', 700: '#b45309', 800: '#92400e', 900: '#78350f', 950: '#451a03',
        },
      },
    },
  },
  plugins: [],
};
