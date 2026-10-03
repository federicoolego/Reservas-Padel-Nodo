/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Paleta de NODO (los nombres se mantienen para no tocar los componentes)
        noche: '#042D29',     // verde del logo: encabezados y textos
        escudo: '#0F5A4E',    // verde medio: botones y acentos
        pelota: '#D2DA1F',    // amarillo de la pelota
        rojo: '#C8323A',      // rojo -> turno reservado
        cesped: '#2E8B57',    // verde -> turno libre
        niebla: '#F2F6F4',
        tinta: '#56706A',
        linea: '#D3E0DC',
      },
      fontFamily: {
        tablero: ['"Barlow Condensed"', '"Arial Narrow"', 'sans-serif'],
        sans: ['Barlow', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
