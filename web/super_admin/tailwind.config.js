/** @type {import('tailwindcss').Config} */
// AFFIA FOODSdesign tokens. Hex values mirror packages/kraveo_ui (KraveoPalette / KStatus / KraveoTokens.driver).
// Keep in sync with src/lib/tokens.ts (used where a raw hex is required, e.g. Recharts).
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        kraveo: {
          // Royal blue ramp (brand = g800). Names kept from the earlier green palette, same values as packages/kraveo_ui.
          g50: '#EEF2FE',
          g100: '#E0E7FD',
          g200: '#C2D0FB',
          g300: '#93ACF5',
          g400: '#5F84EC', // dark-surface brand (driver/admin)
          g500: '#2F5BE0',
          g600: '#2A4FCF',
          g700: '#2549BD',
          g800: '#1C3A9A', // brand
          g900: '#142A73',
          g950: '#0C1A4A',
          brand: '#1C3A9A',
          brandSoft: '#11193A',
          // Gold yellow (accent / primary CTA, brand = 400)
          yellow: '#F5B70A',
          y100: '#FDF1CC',
          y200: '#FBDB7D',
          y300: '#F8C93F',
          y400: '#F5B70A',
          y500: '#D99E00',
          y700: '#7A5800',
          // Cream (used only on the logo badge)
          cream: '#FBF8F1',
          // Light neutrals, same as the landing site (names kept: night = page background, surface = cards)
          night: '#F7F8FB',
          surface: '#FFFFFF',
          surface2: '#F1F3F8',
          line: '#E7EAF1',
          ink: '#141A30',
          ink2: '#4A5168',
          ink3: '#6B7391',
          // Semantic
          success: '#16A34A',
          warning: '#C2410C',
          danger: '#D92D3A',
          info: '#2F5BE0',
          // One status language across every AFFIA FOODSsurface
          status: {
            // Darker than the dark-theme values so text stays readable on white
            placed: '#B7791F',
            accepted: '#0F766E',
            preparing: '#C2410C',
            ready: '#4D7C0F',
            pickedUp: '#2F5BE0',
            atGate: '#6D28D9',
            delivered: '#15803D',
            cancelled: '#D92D3A',
          },
        },
      },
      fontFamily: {
        sans: ['"Plus Jakarta Sans Variable"', '"Plus Jakarta Sans"', 'system-ui', 'sans-serif'],
        display: ['"Bricolage Grotesque Variable"', '"Bricolage Grotesque"', '"Plus Jakarta Sans Variable"', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        'k-sm': '12px',
        'k-md': '16px',
        'k-lg': '20px',
        'k-xl': '24px',
        'k-2xl': '32px',
      },
      boxShadow: {
        // KShadow.soft / lift / glow. Dark surfaces need a stronger alpha than the light apps to stay visible.
        'k-soft': '0 1px 2px rgba(20,26,48,0.04), 0 6px 18px -10px rgba(20,26,48,0.08)',
        'k-lift': '0 18px 40px -16px rgba(20,26,48,0.18)',
        'k-glow': '0 10px 24px -8px rgba(47,91,224,0.45)',
        'k-glow-yellow': '0 10px 24px -8px rgba(245,183,10,0.55)',
      },
      transitionDuration: {
        fast: '140ms',
        base: '260ms',
        slow: '480ms',
      },
      transitionTimingFunction: {
        emphasized: 'cubic-bezier(0.215, 0.61, 0.355, 1)', // easeOutCubic
        spring: 'cubic-bezier(0.175, 0.885, 0.32, 1.275)', // easeOutBack
      },
      keyframes: {
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'scale-in': {
          '0%': { opacity: '0', transform: 'scale(0.96)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        'slide-in-right': {
          '0%': { transform: 'translateX(100%)' },
          '100%': { transform: 'translateX(0)' },
        },
        'slide-in-left': {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(0)' },
        },
        'slide-up': {
          '0%': { transform: 'translateY(100%)' },
          '100%': { transform: 'translateY(0)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '150% 0' },
          '100%': { backgroundPosition: '-50% 0' },
        },
        'dot-pulse': {
          '0%': { boxShadow: '0 0 0 0 var(--dot, rgba(95,132,236,0.55))' },
          '70%': { boxShadow: '0 0 0 7px transparent' },
          '100%': { boxShadow: '0 0 0 0 transparent' },
        },
        'ring-out': {
          '0%': { transform: 'scale(0.6)', opacity: '0.7' },
          '100%': { transform: 'scale(2.4)', opacity: '0' },
        },
        'toast-in': {
          '0%': { opacity: '0', transform: 'translateY(-18px) scale(0.97)' },
          '100%': { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
        'toast-timer': {
          '0%': { transform: 'scaleX(1)' },
          '100%': { transform: 'scaleX(0)' },
        },
      },
      animation: {
        'fade-up': 'fade-up 480ms cubic-bezier(0.215, 0.61, 0.355, 1) both',
        'fade-in': 'fade-in 260ms ease-out both',
        'scale-in': 'scale-in 260ms cubic-bezier(0.175, 0.885, 0.32, 1.275) both',
        'slide-in-right': 'slide-in-right 320ms cubic-bezier(0.215, 0.61, 0.355, 1) both',
        'slide-in-left': 'slide-in-left 280ms cubic-bezier(0.215, 0.61, 0.355, 1) both',
        'slide-up': 'slide-up 320ms cubic-bezier(0.215, 0.61, 0.355, 1) both',
        shimmer: 'shimmer 1.4s linear infinite',
        'dot-pulse': 'dot-pulse 1.6s ease-out infinite',
        'ring-out': 'ring-out 2s ease-out infinite',
        'toast-in': 'toast-in 320ms cubic-bezier(0.175, 0.885, 0.32, 1.275) both',
        'toast-timer': 'toast-timer linear forwards',
      },
    },
  },
  plugins: [],
}
