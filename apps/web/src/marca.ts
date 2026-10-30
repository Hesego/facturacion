// Activos de marca. Son los archivos maestros que entrega Comunicaciones (ver brand/README.md);
// el logo nunca se redibuja ni se recolorea. Si un archivo falta, la interfaz muestra un
// marcador de texto que no imita el logotipo.
export const MARCA = {
  logo: {
    // Versión A: color sobre fondo claro · Versión B: blanco sobre navy (lámina 6)
    color: ['/brand/logo-cuadrado-color.svg', '/brand/logo-cuadrado-color.png'],
    blanco: ['/brand/logo-cuadrado-blanco.svg', '/brand/logo-cuadrado-blanco.png'],
  },
  nombre: 'Hesego Ingeniería S.A.S.',
  producto: 'Flujo de gastos',
  frase: 'Trabajamos de manera segura, confiable y diligente.',
} as const;
