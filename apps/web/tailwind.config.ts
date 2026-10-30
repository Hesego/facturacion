import type { Config } from 'tailwindcss';

// Paleta de aplicación del Manual de Marca Hesego v1.1 (lámina 10). Los colores del logotipo
// viven solo en el logotipo; con estos se construye todo lo demás.
// Reglas de contraste (lámina 11): texto corriente en tinta; teal profundo como texto solo sobre
// blanco; teal vivo y naranja vivo NUNCA como texto pequeño (solo rellenos, barras y degradados).
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        tinta: '#14313B',
        'teal-vivo': '#00AEC6',
        'teal-profundo': '#0A7D8C',
        naranja: '#FF6B1A',
        'naranja-profundo': '#B45309',
        ambar: '#E0A00E',
        verde: '#12A594',
        rojo: '#C0392B',
        navy: { DEFAULT: '#0E4A57', oscuro: '#0A343E' },
        papel: '#F1F5F7',
        linea: '#E2EAED',
        secundario: '#3B565F',
        meta: '#4E646E',
        // Semáforo de SLA (decisión 6). Escala de estado validada para daltonismo (ΔE ≥ 8 entre
        // vecinos): el naranja vivo y el ámbar se confundían, por eso el naranja usa el profundo.
        // Siempre va acompañado de texto; nunca el color solo.
        semaforo: { verde: '#12A594', amarillo: '#E0A00E', naranja: '#B45309', rojo: '#7F1D1D' },
        // Sobre navy (lámina 10)
        'navy-kicker': '#6FD9E6',
        'navy-texto': '#EAF6F8',
        'navy-suave': '#BFE3E9',
        'navy-cifra': '#FFB980',
      },
      fontFamily: {
        // Sustitutas de la lámina 13 cuando no hay fuente: Arial Black y Arial
        titular: ['Anton', '"Arial Black"', 'sans-serif'],
        cuerpo: ['"Glacial Indifference"', 'Arial', 'sans-serif'],
        etiqueta: ['Rajdhani', 'Arial', 'sans-serif'],
        cifra: ['"Saira Condensed"', '"Arial Black"', 'sans-serif'],
      },
      borderRadius: { tarjeta: '16px' },
      boxShadow: {
        // Sombra suave teñida de navy, nunca negro puro (lámina 14)
        tarjeta: '0 1px 2px rgba(14, 74, 87, 0.06), 0 8px 24px -12px rgba(14, 74, 87, 0.18)',
        flotante: '0 24px 48px -16px rgba(10, 52, 62, 0.35)',
      },
      backgroundImage: {
        // Regla de color: degradado naranja → teal
        regla: 'linear-gradient(90deg, #FF6B1A 0%, #00AEC6 100%)',
        'acento-teal': 'linear-gradient(90deg, #00AEC6 0%, #0A7D8C 100%)',
        'acento-naranja': 'linear-gradient(90deg, #FF6B1A 0%, #E0A00E 100%)',
        'panel-navy': 'linear-gradient(160deg, #0E4A57 0%, #0A343E 100%)',
        'chip-teal': 'linear-gradient(135deg, #00AEC6 0%, #0A7D8C 100%)',
        'chip-naranja': 'linear-gradient(135deg, #FF6B1A 0%, #E0A00E 100%)',
      },
      letterSpacing: { kicker: '0.18em', chip: '0.12em' },
    },
  },
  plugins: [],
} satisfies Config;
