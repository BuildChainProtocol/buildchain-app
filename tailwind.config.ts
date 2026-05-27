import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        bc: {
          dark: '#0f1923',
          navy: '#162032',
          card: '#1e2d40',
          border: '#2a3f57',
          gold: '#c9a84c',
          'gold-light': '#e8c97a',
          blue: '#2d7dd2',
          teal: '#1ab3a6',
          muted: '#7f9ab0',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
export default config
