import yggdrasilPreset from '@yggdrasil-lab/ui/tailwind-preset'

/** @type {import('tailwindcss').Config} */
export default {
  presets: [yggdrasilPreset],
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
    "./node_modules/@yggdrasil-lab/ui/dist/**/*.{js,mjs,cjs}",
    "./node_modules/@yggdrasil-lab/ui/dist/*.{js,mjs,cjs}",
  ],
  plugins: [],
}
