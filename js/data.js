/**
 * js/data.js
 * -----------------------------------------------------------------------
 * Módulo de datos de la app — ahora conectado a la API real
 * (Cloudflare Worker + D1) en vez de usar datos mock en memoria.
 *
 * Patrón: init() carga categorías y movimientos reales una vez, y los deja
 * en caché local (movimientos/categorias). Las funciones de lectura
 * (getMovimientos, getCategorias...) siguen siendo síncronas y leen de esa
 * caché, así que grafica.js, movimientos.js y categorias.js casi no
 * necesitan cambios. Las funciones que escriben (addMovimiento,
 * addCategoria, deleteCategoria, updateCategoriaPresupuesto) ahora son
 * asíncronas (devuelven una Promise), porque hacen una llamada real a la
 * API antes de actualizar la caché local.
 * -----------------------------------------------------------------------
 */

const AppData = (function () {

  const API_BASE = 'https://cuentas-familia-api.israel-reyes.workers.dev';

  let movimientos = [];
  let categorias = [];

  const colorPalette = ["#B7912B", "#C1443D", "#1E8A63", "#6B5B95", "#3E7C8C", "#8C5E3E", "#5A5F73", "#B0567E"];

  // ---- helper interno para llamar a la API ----

  async function apiFetch(path, options) {
    const res = await fetch(API_BASE + path, Object.assign({
      headers: { 'Content-Type': 'application/json' },
    }, options));

    let data = null;
    try { data = await res.json(); } catch (_) { /* respuesta sin cuerpo JSON */ }

    if (!res.ok) {
      const err = new Error((data && data.message) || (data && data.error) || 'Error de conexión con el servidor');
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  function esDelMesActual(fechaStr) {
    const hoy = new Date();
    const f = new Date(fechaStr);
    return f.getFullYear() === hoy.getFullYear() && f.getMonth() === hoy.getMonth();
  }

  // ---- carga inicial ----

  /** Se llama una vez al arrancar la app, antes de inicializar los demás módulos. */
  async function init() {
    const [cats, movs] = await Promise.all([
      apiFetch('/api/categorias'),
      apiFetch('/api/movimientos'),
    ]);
    categorias = cats;
    movimientos = movs;
  }

  // ---- movimientos ----

  function getMovimientos() {
    return movimientos;
  }

  async function addMovimiento(mov) {
    const nuevo = await apiFetch('/api/movimientos', {
      method: 'POST',
      body: JSON.stringify({
        descripcion: mov.desc,
        categoria: mov.cat,
        tipo: mov.tipo,
        importe: mov.importe,
        fecha: mov.fecha,
      }),
    });

    movimientos.unshift(nuevo);

    const cat = categorias.find(c => c.nombre === nuevo.cat);
    if (cat) {
      cat.movimientos = (cat.movimientos || 0) + 1;
      if (nuevo.tipo === 'expense' && esDelMesActual(nuevo.fecha)) {
        cat.gastado = (cat.gastado || 0) + nuevo.importe;
      }
    }

    return nuevo;
  }

  // ---- categorías ----

  function getCategorias() {
    return categorias;
  }

  function getCategoriasConGasto() {
    return categorias
      .filter(c => c.gastado > 0 || c.presupuesto > 0)
      .sort((a, b) => b.gastado - a.gastado);
  }

  function getCategoriasOrdenadas() {
    return [...categorias].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  }

  function categoriaExiste(nombre) {
    return categorias.some(c => c.nombre.toLowerCase() === nombre.toLowerCase());
  }

  async function addCategoria({ nombre, color, presupuesto }) {
    const nueva = await apiFetch('/api/categorias', {
      method: 'POST',
      body: JSON.stringify({ nombre, color, presupuesto: presupuesto || 0 }),
    });
    categorias.push(nueva);
    return nueva;
  }

  /**
   * Intenta borrar una categoría.
   * - Sin `reassignTo`: si el servidor responde 409 porque tiene movimientos,
   *   la promesa se rechaza con err.data.error === 'tiene_movimientos' y
   *   err.data.count con el número de movimientos afectados.
   * - Con `reassignTo`: el servidor mueve esos movimientos a la categoría
   *   indicada y borra la original.
   */
  async function deleteCategoria(nombre, reassignTo) {
    await apiFetch('/api/categorias/' + encodeURIComponent(nombre), {
      method: 'DELETE',
      body: JSON.stringify(reassignTo ? { reassignTo } : {}),
    });

    categorias = categorias.filter(c => c.nombre !== nombre);

    if (reassignTo) {
      movimientos.forEach(m => { if (m.cat === nombre) m.cat = reassignTo; });
      const destino = categorias.find(c => c.nombre === reassignTo);
      const origenMovs = movimientos.filter(m => m.cat === reassignTo).length; // aproximado, se recalcula en próxima carga
      if (destino) destino.movimientos = origenMovs;
    } else {
      movimientos = movimientos.filter(m => m.cat !== nombre);
    }
  }

  async function updateCategoriaPresupuesto(nombre, presupuesto) {
    const actualizado = await apiFetch('/api/categorias/' + encodeURIComponent(nombre), {
      method: 'PATCH',
      body: JSON.stringify({ presupuesto: Math.max(0, presupuesto || 0) }),
    });
    const cat = categorias.find(c => c.nombre === nombre);
    if (cat) cat.presupuesto = actualizado.presupuesto;
    return cat;
  }

  function getColorPalette() {
    return colorPalette;
  }

  // ---- gráfica: calculada a partir de los movimientos reales ----

  const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

  function getAvailableYears() {
    const years = new Set(movimientos.map(m => new Date(m.fecha).getFullYear()));
    years.add(new Date().getFullYear());
    return [...years].sort();
  }

  function getYearData(year) {
    const hoy = new Date();
    const esAnoActual = year === hoy.getFullYear();
    const ultimoMes = esAnoActual ? hoy.getMonth() : 11;

    const ingresos = new Array(ultimoMes + 1).fill(0);
    const gastos = new Array(ultimoMes + 1).fill(0);

    movimientos.forEach(m => {
      const f = new Date(m.fecha);
      if (f.getFullYear() !== year) return;
      const mi = f.getMonth();
      if (mi > ultimoMes) return;
      if (m.tipo === 'income') ingresos[mi] += m.importe;
      else gastos[mi] += m.importe;
    });

    return {
      labels: MESES.slice(0, ultimoMes + 1),
      ingresos,
      gastos,
    };
  }

  function getCategoryBreakdown(year, monthIndex) {
    const items = {};
    let total = 0;

    movimientos.forEach(m => {
      const f = new Date(m.fecha);
      if (f.getFullYear() !== year || f.getMonth() !== monthIndex || m.tipo !== 'expense') return;
      total += m.importe;
      if (!items[m.cat]) {
        const catInfo = categorias.find(c => c.nombre === m.cat);
        items[m.cat] = { nombre: m.cat, color: (catInfo && catInfo.color) || '#5A5F73', gastado: 0 };
      }
      items[m.cat].gastado += m.importe;
    });

    const lista = Object.values(items).sort((a, b) => b.gastado - a.gastado);
    return { total, items: lista };
  }

  // ---- API pública del módulo ----
  return {
    init,
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
