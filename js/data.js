/**
 * js/data.js
 * -----------------------------------------------------------------------
 * Módulo de datos de la app.
 *
 * Por ahora los datos viven en memoria (mock), pero todo el resto de la
 * app accede a ellos SOLO a través de las funciones que expone AppData.
 * Esto significa que en el Paso 10, cuando conectemos el backend real,
 * solo habrá que reescribir el interior de este fichero (por ejemplo,
 * que addMovimiento() haga un fetch() en vez de un unshift() en memoria)
 * y el resto de módulos (movimientos.js, categorias.js, grafica.js...)
 * no necesitarán ningún cambio.
 * -----------------------------------------------------------------------
 */

const AppData = (function () {

  // ---- estado interno (privado) ----

  let movimientos = [
    { desc: "Nómina Israel", cat: "Nómina", tipo: "income", importe: 1850.00 },
    { desc: "Compra semanal Mercadona", cat: "Supermercado", tipo: "expense", importe: 96.40 },
    { desc: "Factura luz", cat: "Casa y suministros", tipo: "expense", importe: 78.20 },
    { desc: "Gasolina", cat: "Transporte", tipo: "expense", importe: 55.00 },
    { desc: "Cine familiar", cat: "Ocio", tipo: "expense", importe: 32.00 },
    { desc: "Paga extra", cat: "Nómina", tipo: "income", importe: 300.00 },
    { desc: "Farmacia", cat: "Salud", tipo: "expense", importe: 18.90 },
  ];

  let categorias = [
    { nombre: "Supermercado", color: "#B7912B", gastado: 412.30, presupuesto: 500, movimientos: 14 },
    { nombre: "Casa y suministros", color: "#C1443D", gastado: 378.20, presupuesto: 400, movimientos: 6 },
    { nombre: "Transporte", color: "#1E8A63", gastado: 210.00, presupuesto: 250, movimientos: 9 },
    { nombre: "Ocio", color: "#6B5B95", gastado: 145.00, presupuesto: 150, movimientos: 5 },
    { nombre: "Salud", color: "#3E7C8C", gastado: 88.90, presupuesto: 150, movimientos: 2 },
    { nombre: "Colegio / niños", color: "#8C5E3E", gastado: 575.10, presupuesto: 600, movimientos: 11 },
    { nombre: "Nómina", color: "#2F6E4E", gastado: 0, presupuesto: 0, movimientos: 2 },
  ];

  const colorPalette = ["#B7912B", "#C1443D", "#1E8A63", "#6B5B95", "#3E7C8C", "#8C5E3E", "#5A5F73", "#B0567E"];

  // datos de la gráfica por año (mock). 2026 solo tiene datos hasta agosto
  // por ser el año en curso.
  const yearlyData = {
    2024: {
      labels: ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'],
      ingresos: [1900,1900,1950,1950,2000,2200,2000,2000,1950,2000,2100,2450],
      gastos:   [1500,1480,1600,1700,1550,1850,1750,1800,1600,1580,1780,2250]
    },
    2025: {
      labels: ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'],
      ingresos: [2000,2000,2050,2050,2100,2350,2100,2100,2050,2100,2200,2600],
      gastos:   [1600,1550,1700,1800,1620,1980,1850,1950,1700,1680,1900,2400]
    },
    2026: {
      labels: ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago'],
      ingresos: [2100,2100,2100,2150,2100,2400,2150,2150],
      gastos:   [1650,1720,1780,1920,1650,2050,1890,1809.5]
    }
  };
  const availableYears = [2024, 2025, 2026];

  // ---- movimientos ----

  function getMovimientos() {
    return movimientos;
  }

  function addMovimiento(mov) {
    movimientos.unshift(mov);
    return mov;
  }

  // ---- categorías ----

  function getCategorias() {
    return categorias;
  }

  /** Categorías con gasto real o presupuesto asignado (para la pestaña de gasto mensual). */
  function getCategoriasConGasto() {
    return categorias
      .filter(c => c.gastado > 0 || c.presupuesto > 0)
      .sort((a, b) => b.gastado - a.gastado);
  }

  /** Todas las categorías ordenadas alfabéticamente (para el selector y la administración). */
  function getCategoriasOrdenadas() {
    return [...categorias].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  }

  function categoriaExiste(nombre) {
    return categorias.some(c => c.nombre.toLowerCase() === nombre.toLowerCase());
  }

  function addCategoria({ nombre, color, presupuesto }) {
    const nueva = { nombre, color, gastado: 0, presupuesto: presupuesto || 0, movimientos: 0 };
    categorias.push(nueva);
    return nueva;
  }

  function deleteCategoria(nombre) {
    categorias = categorias.filter(c => c.nombre !== nombre);
  }

  function updateCategoriaPresupuesto(nombre, presupuesto) {
    const cat = categorias.find(c => c.nombre === nombre);
    if (cat) cat.presupuesto = Math.max(0, presupuesto || 0);
    return cat;
  }

  function getColorPalette() {
    return colorPalette;
  }

  // ---- gráfica ----

  function getAvailableYears() {
    return availableYears;
  }

  function getYearData(year) {
    return yearlyData[year];
  }

  /**
   * Reparto de gasto por categoría de un mes concreto (mock).
   * Distribuye el total gastado ese mes proporcionalmente al peso de
   * gasto habitual de cada categoría, con una variación determinista
   * (misma semilla = mismo resultado, para que no "baile" en cada render).
   */
  function getCategoryBreakdown(year, monthIndex) {
    const d = yearlyData[year];
    const total = d.gastos[monthIndex];
    const cats = categorias.filter(c => c.presupuesto > 0 || c.gastado > 0);

    const seed = year * 100 + monthIndex;
    const seededRand = (s) => {
      const x = Math.sin(s) * 10000;
      return x - Math.floor(x);
    };

    const weights = cats.map((c, i) => (c.gastado || 60) * (0.7 + seededRand(seed + i * 7.3) * 0.6));
    const sumW = weights.reduce((a, b) => a + b, 0) || 1;

    const items = cats
      .map((c, i) => ({ nombre: c.nombre, color: c.color, gastado: total * weights[i] / sumW }))
      .sort((a, b) => b.gastado - a.gastado);

    return { total, items };
  }

  // ---- API pública del módulo ----
  return {
    getMovimientos,
    addMovimiento,
    getCategorias,
    getCategoriasConGasto,
    getCategoriasOrdenadas,
    categoriaExiste,
    addCategoria,
    deleteCategoria,
    updateCategoriaPresupuesto,
    getColorPalette,
    getAvailableYears,
    getYearData,
    getCategoryBreakdown,
  };

})();
