/**
 * js/data.js
 * -----------------------------------------------------------------------
 * Módulo de datos de la app — conectado a la API real
 * (Cloudflare Worker + D1) en vez de usar datos mock en memoria.
 * -----------------------------------------------------------------------
 */

const AppData = (function () {

  const API_BASE = 'https://cuentas-familia-api.israel-reyes.workers.dev';

  let movimientos = [];
  let categorias = [];

  const colorPalette = ["#B7912B", "#C1443D", "#1E8A63", "#6B5B95", "#3E7C8C", "#8C5E3E", "#5A5F73", "#B0567E"];

  async function apiFetch(path, options) {
    const token = Auth.getToken();
    const headers = Object.assign(
      { 'Content-Type': 'application/json' },
      token ? { Authorization: 'Bearer ' + token } : {},
      (options && options.headers) || {}
    );

    const res = await fetch(API_BASE + path, Object.assign({}, options, { headers }));

    let data = null;
    try { data = await res.json(); } catch (_) {}

    if (res.status === 401) {
      Auth.forceLogout();
      throw new Error('Tu sesión ha caducado. Vuelve a iniciar sesión.');
    }

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

  async function init() {
    const [cats, movs] = await Promise.all([
      apiFetch('/api/categorias'),
      apiFetch('/api/movimientos'),
    ]);
    categorias = cats;
    movimientos = movs;
  }

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

  async function deleteMovimiento(id) {
    await apiFetch('/api/movimientos/' + id, { method: 'DELETE' });

    const borrado = movimientos.find(m => m.id === id);
    movimientos = movimientos.filter(m => m.id !== id);

    if (borrado) {
      const cat = categorias.find(c => c.nombre === borrado.cat);
      if (cat) {
        cat.movimientos = Math.max(0, (cat.movimientos || 0) - 1);
        if (borrado.tipo === 'expense' && esDelMesActual(borrado.fecha)) {
          cat.gastado = Math.max(0, (cat.gastado || 0) - borrado.importe);
        }
      }
    }
  }

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

  function getCategoriasParaGasto() {
    return getCategoriasOrdenadas().filter(c => !c.fija);
  }

  function categoriaExiste(nombre) {
    return categorias.some(c => c.nombre.toLowerCase() === nombre.toLowerCase());
  }

  async function addCategoria({ nombre, color, presupuesto, fija }) {
    const nueva = await apiFetch('/api/categorias', {
      method: 'POST',
      body: JSON.stringify({ nombre, color, presupuesto: presupuesto || 0, fija: !!fija }),
    });
    categorias.push(nueva);
    return nueva;
  }

  async function deleteCategoria(nombre, reassignTo) {
    await apiFetch('/api/categorias/' + encodeURIComponent(nombre), {
      method: 'DELETE',
      body: JSON.stringify(reassignTo ? { reassignTo } : {}),
    });

    categorias = categorias.filter(c => c.nombre !== nombre);

    if (reassignTo) {
      const destino = categorias.find(c => c.nombre === reassignTo);
      movimientos.forEach(m => {
        if (m.cat !== nombre) return;
        m.cat = reassignTo;
        if (destino) {
          destino.movimientos = (destino.movimientos || 0) + 1;
          if (m.tipo === 'expense' && esDelMesActual(m.fecha)) {
            destino.gastado = (destino.gastado || 0) + m.importe;
          }
        }
      });
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

  async function updateCategoriaFija(nombre, fija) {
    const actualizado = await apiFetch('/api/categorias/' + encodeURIComponent(nombre), {
      method: 'PATCH',
      body: JSON.stringify({ fija: !!fija }),
    });
    const cat = categorias.find(c => c.nombre === nombre);
    if (cat) cat.fija = actualizado.fija;
    return cat;
  }

  function getColorPalette() {
    return colorPalette;
  }

  /**
   * SOLO PRUEBA: llama al endpoint que genera ya los gastos fijos del
   * mes, sin esperar al día 1. Tras llamarlo, refresca movimientos y
   * categorías desde el servidor para reflejar lo que se haya creado.
   */
  async function generarFijosAhora() {
    const res = await apiFetch('/api/categorias/generar-fijos', { method: 'POST' });
    await init();
    return res;
  }

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

  return {
    init,
    getMovimientos,
    addMovimiento,
    deleteMovimiento,
    getCategorias,
    getCategoriasConGasto,
    getCategoriasOrdenadas,
    getCategoriasParaGasto,
    categoriaExiste,
    addCategoria,
    deleteCategoria,
    updateCategoriaPresupuesto,
    updateCategoriaFija,
    generarFijosAhora,
    getColorPalette,
    getAvailableYears,
    getYearData,
    getCategoryBreakdown,
  };

})();
