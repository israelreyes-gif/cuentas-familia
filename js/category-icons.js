/**
 * js/category-icons.js
 * -----------------------------------------------------------------------
 * Asigna un icono a cada categoría según palabras clave en su nombre.
 * No se guarda nada en la base de datos: se calcula al vuelo cada vez
 * que se pinta una categoría, así que funciona automáticamente también
 * con categorías nuevas que el usuario cree en el futuro.
 * -----------------------------------------------------------------------
 */

const CategoryIcons = (function () {

  // Cada icono son los <path>/<circle> internos de un <svg viewBox="0 0 24 24">,
  // en el mismo estilo (trazo, sin relleno) que los iconos de la barra inferior.
  const PATHS = {
    home: '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h5v-6h4v6h5V10"/>',
    water: '<path d="M12 3s6.5 7.5 6.5 12a6.5 6.5 0 0 1-13 0C5.5 10.5 12 3 12 3z"/>',
    bolt: '<path d="M13 2 4 14h6l-1 8 9-12h-6l1-8z"/>',
    flame: '<path d="M12 2c2 4-2 5.5-2 9a3 3 0 0 0 6 0c0-2-1-3-1-3s3 2.5 3 6.5A6.5 6.5 0 0 1 5.5 14.5C5.5 9 9.5 6.5 12 2z"/>',
    wifi: '<path d="M2 8.5a16 16 0 0 1 20 0"/><path d="M5 12a11 11 0 0 1 14 0"/><path d="M8.5 15.5a6 6 0 0 1 7 0"/><circle cx="12" cy="19" r="1" fill="currentColor" stroke="none"/>',
    cart: '<circle cx="9" cy="21" r="1" fill="currentColor" stroke="none"/><circle cx="18" cy="21" r="1" fill="currentColor" stroke="none"/><path d="M2 3h2l2.6 12.4a2 2 0 0 0 2 1.6h8.3a2 2 0 0 0 2-1.6L22 7H6"/>',
    food: '<path d="M6 2v7a2 2 0 0 0 4 0V2"/><path d="M8 9v13"/><path d="M17 2c-1.7 1.4-2 3-2 5.5S17 12 17 12v10"/>',
    car: '<path d="M3 13l1.8-5.5A2 2 0 0 1 6.7 6h10.6a2 2 0 0 1 1.9 1.5L21 13"/><path d="M3 13h18v5H3z"/><circle cx="7.5" cy="18" r="1.6"/><circle cx="16.5" cy="18" r="1.6"/>',
    health: '<circle cx="12" cy="12" r="9"/><path d="M12 8v8"/><path d="M8 12h8"/>',
    tooth: '<path d="M12 3c-2.8 0-5 1.9-5 4.7 0 2.7.9 3.6 1.2 6.5.2 2 .6 6.8 2 6.8s1.4-3.7 1.8-5.8c.1-.6.6-.6.7 0 .4 2.1.6 5.8 2 5.8s1.8-4.8 2-6.8c.3-2.9 1.2-3.8 1.2-6.5C17 4.9 14.8 3 12 3z"/>',
    school: '<path d="M2 9 12 4l10 5-10 5-10-5z"/><path d="M6 11.5V17c0 1.5 2.7 3 6 3s6-1.5 6-3v-5.5"/>',
    book: '<path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H19v17H6.5A2.5 2.5 0 0 0 4 21.5v-17z"/><path d="M19 19H6.5A2.5 2.5 0 0 0 4 21.5"/>',
    shirt: '<path d="M8 3 4 7l3 3v11h10V10l3-3-4-4-2 2h-4L8 3z"/>',
    paw: '<circle cx="6.5" cy="9.5" r="2"/><circle cx="12" cy="6" r="2"/><circle cx="17.5" cy="9.5" r="2"/><path d="M6.5 15c0-2.5 2.5-3.5 5.5-3.5s5.5 1 5.5 3.5-2.7 4.5-5.5 4.5-5.5-2-5.5-4.5z"/>',
    film: '<circle cx="12" cy="12" r="9"/><path d="M10 8.3v7.4l6.5-3.7L10 8.3z"/>',
    dumbbell: '<path d="M4 8v8"/><path d="M2 10v4"/><path d="M20 8v8"/><path d="M22 10v4"/><path d="M8 12h8"/><path d="M8 9v6"/><path d="M16 9v6"/>',
    shield: '<path d="M12 2 4 5.5v5.5c0 5 3.4 8.9 8 10 4.6-1.1 8-5 8-10V5.5L12 2z"/>',
    plane: '<path d="M2 12 22 4l-8 20-2-8-8-2z"/>',
    gift: '<rect x="3" y="8" width="18" height="13" rx="1"/><path d="M3 12h18"/><path d="M12 8v13"/><path d="M12 8C11 4.5 6 4.5 6 7.2S9 8 12 8z"/><path d="M12 8c1-3.5 6-3.5 6-.8S15 8 12 8z"/>',
    briefcase: '<rect x="2" y="7" width="20" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M2 12h20"/>',
    tag: '<path d="M20 12 12 20l-8-8V4h8l8 8z"/><circle cx="7.5" cy="7.5" r="1.4" fill="currentColor" stroke="none"/>',
  };

  // Palabras clave (sin acentos, en minúscula) que asignan cada icono.
  // Se comprueban en orden, la primera que encaje gana.
  const REGLAS = [
    { icon: 'home', match: ['alquiler', 'hipoteca', 'vivienda', 'comunidad', 'piso', 'casa'] },
    { icon: 'water', match: ['agua'] },
    { icon: 'bolt', match: ['luz', 'electricidad', 'electrica'] },
    { icon: 'flame', match: ['gas', 'calefaccion'] },
    { icon: 'wifi', match: ['internet', 'wifi', 'router', 'movil', 'telefono', 'telefonia'] },
    { icon: 'cart', match: ['supermercado', 'compra', 'alimentacion', 'mercadona', 'carrefour', 'lidl'] },
    { icon: 'food', match: ['restaurante', 'comida', 'cena', 'bar', 'cafeteria'] },
    { icon: 'car', match: ['coche', 'gasolina', 'combustible', 'parking', 'transporte', 'uber', 'taxi', 'metro', 'bus'] },
    { icon: 'tooth', match: ['dentista', 'dental'] },
    { icon: 'health', match: ['salud', 'medico', 'farmacia', 'clinica', 'seguro medico'] },
    { icon: 'school', match: ['colegio', 'escuela', 'guarderia'] },
    { icon: 'book', match: ['oposicion', 'oposiciones', 'curso', 'formacion', 'academia', 'educacion', 'ingles', 'frances', 'aleman', 'italiano', 'chino', 'idioma', 'idiomas', 'clases particulares'] },
    { icon: 'shirt', match: ['ropa', 'moda', 'zapatos', 'calzado'] },
    { icon: 'paw', match: ['mascota', 'perro', 'gato', 'veterinario'] },
    { icon: 'film', match: ['ocio', 'cine', 'netflix', 'spotify', 'suscripcion', 'streaming', 'hbo', 'disney'] },
    {
      icon: 'dumbbell',
      match: [
        'gimnasio', 'gym', 'deporte', 'baile', 'danza', 'futbol', 'boxeo', 'natacion',
        'tenis', 'padel', 'baloncesto', 'atletismo', 'running', 'ciclismo', 'spinning',
        'yoga', 'pilates', 'judo', 'karate', 'artes marciales', 'voleibol', 'rugby', 'escalada',
      ],
    },
    { icon: 'shield', match: ['seguro'] },
    { icon: 'plane', match: ['viaje', 'vacaciones', 'hotel', 'vuelo', 'avion'] },
    { icon: 'gift', match: ['regalo', 'cumpleanos', 'navidad'] },
    { icon: 'briefcase', match: ['nomina', 'sueldo', 'salario', 'trabajo'] },
  ];

  function normalizar(str) {
    return String(str || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
  }

  function getIconKey(nombre) {
    const n = normalizar(nombre);
    for (const regla of REGLAS) {
      if (regla.match.some(kw => n.includes(kw))) return regla.icon;
    }
    return 'tag';
  }

  function render(nombre) {
    const key = getIconKey(nombre);
    const inner = PATHS[key] || PATHS.tag;
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
  }

  return { render, getIconKey };

})();
