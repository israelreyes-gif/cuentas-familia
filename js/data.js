/**
 * js/data.js
 * -----------------------------------------------------------------------
 * Módulo de datos de la app — conectado a la API real a través del
 * proxy compartido en Deno.
 * -----------------------------------------------------------------------
 */

const AppData = (function () {

  const API_BASE = 'https://api-proxy.israelreyes-gif.deno.net/cuentas-familia';

  let movimientos = [];
  let categorias = [];
  let saldoInicial = 0;

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
    const [cats, movs, config] = await Promise.all([
      apiFetch('/api/categorias'),
      apiFetch('/api/movimientos'),
      apiFetch('/api/config'),
    ]);
    categorias = cats;
    movimientos = movs;
    saldoInicial = Number(config.saldo_inicial) || 0;
  }

  function getSaldoInicial() {
    return saldoInicial;
  }

  /** Saldo acumulado real: saldo inicial + todos los ingresos - todos los gastos, desde siempre. */
  function getSaldoActual() {
    const totalIngresos = movimientos.filter(m => m.tipo === 'income').reduce((sum, m) => sum + m.importe, 0);
    const totalGastos = movimientos.filter(m => m.tipo === 'expense').reduce((sum, m) => sum + m.importe, 0);
    return saldoInicial + totalIngresos - totalGastos;
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
      if (esDelMesActual(nuevo.fecha)) {
        cat.gastado = (cat.gastado || 0) + (nuevo.tipo === 'expense' ? nuevo.importe : -nuevo.importe);
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
        if (esDelMesActual(borrado.fecha)) {
          cat.gastado = (cat.gastado || 0) - (borrado.tipo === 'expense' ? borrado.importe : -borrado.importe);
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
      .sort(compararPorTipoYNombre);
  }

  function getCategoriasOrdenadas() {
    return [...categorias].sort(compararPorTipoYNombre);
  }

  function getCategoriasParaGasto() {
    return getCategoriasOrdenadas().filter(c => !c.fija);
  }

  function categoriaExiste(nombre) {
    return categorias.some(c => c.nombre.toLowerCase() === nombre.toLowerCase());
  }

  /** Variables primero (A-Z), después fijas (A-Z). Se usa en ambas vistas de categorías. */
  function compararPorTipoYNombre(a, b) {
    if (!!a.fija !== !!b.fija) return a.fija ? 1 : -1;
    return a.nombre.localeCompare(b.nombre, 'es');
  }

  const RECURRENCIA_INTERVALOS = { mensual: 1, bimestral: 2, trimestral: 3, cuatrimestral: 4, semestral: 6, anual: 12 };

  /** Misma regla que usa el backend para decidir si a una categoría fija "le toca" un mes concreto (1-12). */
  function tocaMes(cat, mesNumero) {
    const intervalo = RECURRENCIA_INTERVALOS[cat.recurrencia] || 1;
    const mesInicio = cat.mes_inicio || 1;
    const diff = ((mesNumero - mesInicio) % 12 + 12) % 12;
    return diff % intervalo === 0;
  }

  const MESES_LARGO = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

  /** Gastos fijos previstos para los próximos 2 meses (sin contar el actual), respetando la recurrencia de cada categoría. */
  function getProximosGastosFijos() {
    const hoy = new Date();
    const resultado = [];

    for (let offset = 1; offset <= 2; offset++) {
      const fecha = new Date(hoy.getFullYear(), hoy.getMonth() + offset, 1);
      const mesNumero = fecha.getMonth() + 1;

      const cats = categorias
        .filter(c => c.fija && c.presupuesto > 0 && tocaMes(c, mesNumero))
        .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));

      const total = cats.reduce((sum, c) => sum + c.presupuesto, 0);

      resultado.push({
        mes: MESES_LARGO[fecha.getMonth()],
        anio: fecha.getFullYear(),
        categorias: cats,
        total,
      });
    }

    return resultado;
  }

  async function addCategoria({ nombre, color, presupuesto, fija, recurrencia, mesInicio }) {
    const nueva = await apiFetch('/api/categorias', {
      method: 'POST',
      body: JSON.stringify({
        nombre, color, presupuesto: presupuesto || 0, fija: !!fija,
        recurrencia: recurrencia || undefined,
        mes_inicio: mesInicio || undefined,
      }),
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
          if (esDelMesActual(m.fecha)) {
            destino.gastado = (destino.gastado || 0) + (m.tipo === 'expense' ? m.importe : -m.importe);
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

  async function updateCategoriaRecurrencia(nombre, recurrencia, mesInicio) {
    const actualizado = await apiFetch('/api/categorias/' + encodeURIComponent(nombre), {
      method: 'PATCH',
      body: JSON.stringify({ recurrencia, mes_inicio: mesInicio }),
    });
    const cat = categorias.find(c => c.nombre === nombre);
    if (cat) {
      cat.recurrencia = actualizado.recurrencia;
      cat.mes_inicio = actualizado.mes_inicio;
    }
    return cat;
  }

  function getColorPalette() {
    return colorPalette;
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
      if (f.getFullYear() !== year || f.getMonth() !== monthIndex) return;

      const efecto = m.tipo === 'expense' ? m.importe : -m.importe;
      total += efecto;

      if (!items[m.cat]) {
        const catInfo = categorias.find(c => c.nombre === m.cat);
        items[m.cat] = { nombre: m.cat, color: (catInfo && catInfo.color) || '#5A5F73', gastado: 0 };
      }
      items[m.cat].gastado += efecto;
    });

    const lista = Object.values(items).sort((a, b) => b.gastado - a.gastado);
    return { total, items: lista };
  }

  return {
    init,
    getSaldoInicial,
    getSaldoActual,
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
    updateCategoriaRecurrencia,
    getProximosGastosFijos,
    getColorPalette,
    getAvailableYears,
    getYearData,
    getCategoryBreakdown,
  };

})();
