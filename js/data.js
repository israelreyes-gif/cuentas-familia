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

  // ---- estado propio de la Gráfica (ventana móvil de 12 meses) ----
  let historico = [];        // movimientos de la ventana de 12 meses actualmente cargada
  let historicoHasta = null; // { anio, mes } del último mes de esa ventana
  let fechaMinima = null;    // { anio, mes } del movimiento más antiguo que existe, o null si no hay ninguno

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
    const [cats, movs, config, primeraFecha] = await Promise.all([
      apiFetch('/api/categorias'),
      apiFetch('/api/movimientos'),
      apiFetch('/api/config'),
      apiFetch('/api/movimientos/primera-fecha'),
    ]);
    categorias = cats;
    movimientos = movs;
    saldoInicial = Number(config.saldo_inicial) || 0;

    if (primeraFecha && primeraFecha.fecha) {
      const f = new Date(primeraFecha.fecha);
      fechaMinima = { anio: f.getFullYear(), mes: f.getMonth() + 1 };
    } else {
      fechaMinima = null;
    }
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
        mes: UIHelpers.MESES_LARGO[fecha.getMonth()],
        anio: fecha.getFullYear(),
        categorias: cats,
        total,
      });
    }

    return resultado;
  }

  async function addCategoria({ nombre, presupuesto, fija, recurrencia, mesInicio }) {
    const nueva = await apiFetch('/api/categorias', {
      method: 'POST',
      body: JSON.stringify({
        nombre, presupuesto: presupuesto || 0, fija: !!fija,
        recurrencia: recurrencia || undefined,
        mes_inicio: mesInicio || undefined,
      }),
    });
    categorias.push(nueva);
    return nueva;
  }

  async function deleteCategoria(id, reassignTo) {
    const borrada = categorias.find(c => c.id === id);

    await apiFetch('/api/categorias/' + id, {
      method: 'DELETE',
      body: JSON.stringify(reassignTo ? { reassignTo } : {}),
    });

    categorias = categorias.filter(c => c.id !== id);

    if (reassignTo && borrada) {
      const destino = categorias.find(c => c.id === reassignTo);
      movimientos.forEach(m => {
        if (m.cat !== borrada.nombre) return;
        if (destino) {
          m.cat = destino.nombre;
          destino.movimientos = (destino.movimientos || 0) + 1;
          if (esDelMesActual(m.fecha)) {
            destino.gastado = (destino.gastado || 0) + (m.tipo === 'expense' ? m.importe : -m.importe);
          }
        }
      });
    } else if (borrada) {
      movimientos = movimientos.filter(m => m.cat !== borrada.nombre);
    }
  }

  async function updateCategoriaPresupuesto(id, presupuesto) {
    const actualizado = await apiFetch('/api/categorias/' + id, {
      method: 'PATCH',
      body: JSON.stringify({ presupuesto: Math.max(0, presupuesto || 0) }),
    });
    const cat = categorias.find(c => c.id === id);
    if (cat) cat.presupuesto = actualizado.presupuesto;
    return cat;
  }

  async function updateCategoriaFija(id, fija) {
    const actualizado = await apiFetch('/api/categorias/' + id, {
      method: 'PATCH',
      body: JSON.stringify({ fija: !!fija }),
    });
    const cat = categorias.find(c => c.id === id);
    if (cat) cat.fija = actualizado.fija;
    return cat;
  }

  async function updateCategoriaRecurrencia(id, recurrencia, mesInicio) {
    const actualizado = await apiFetch('/api/categorias/' + id, {
      method: 'PATCH',
      body: JSON.stringify({ recurrencia, mes_inicio: mesInicio }),
    });
    const cat = categorias.find(c => c.id === id);
    if (cat) {
      cat.recurrencia = actualizado.recurrencia;
      cat.mes_inicio = actualizado.mes_inicio;
    }
    return cat;
  }

  /**
   * Carga del servidor los movimientos de la ventana de 12 meses que
   * termina en anio-mes (mes: 1-12), y los deja listos para que
   * getVentanaMeses()/getCategoryBreakdownMes() los usen. Se llama cada
   * vez que la Gráfica cambia de mes.
   */
  async function cargarHistorico(anio, mes) {
    const hasta = `${anio}-${String(mes).padStart(2, '0')}`;
    historico = await apiFetch('/api/movimientos/rango?hasta=' + hasta);
    historicoHasta = { anio, mes };
  }

  /** { anio, mes } del movimiento más antiguo registrado, o null si no hay ninguno. */
  function getFechaMinima() {
    return fechaMinima;
  }

  /**
   * Buscador: filtra en todo el histórico (no solo el mes actual ni la
   * ventana de la Gráfica). Devuelve hasta 100 resultados, del más
   * reciente al más antiguo. No toca el estado del resto de la app.
   */
  async function buscarMovimientos({ texto, categoriaId, tipo, desde, hasta }) {
    const params = new URLSearchParams();
    if (texto) params.set('texto', texto);
    if (categoriaId) params.set('categoria_id', categoriaId);
    if (tipo) params.set('tipo', tipo);
    if (desde) params.set('desde', desde);
    if (hasta) params.set('hasta', hasta);

    return apiFetch('/api/movimientos/buscar?' + params.toString());
  }

  /** Datos para las barras del gráfico: labels con año ("Sep 26") + ingresos/gastos mes a mes. */
  function getVentanaMeses() {
    if (!historicoHasta) return { meses: [], labels: [], ingresos: [], gastos: [] };

    const meses = [];
    for (let i = 11; i >= 0; i--) {
      let mes = historicoHasta.mes - i;
      let anio = historicoHasta.anio;
      while (mes < 1) { mes += 12; anio -= 1; }
      meses.push({ anio, mes });
    }

    const ingresos = meses.map(() => 0);
    const gastos = meses.map(() => 0);

    historico.forEach(m => {
      const f = new Date(m.fecha);
      const idx = meses.findIndex(x => x.anio === f.getFullYear() && x.mes === f.getMonth() + 1);
      if (idx === -1) return;
      if (m.tipo === 'income') ingresos[idx] += m.importe;
      else gastos[idx] += m.importe;
    });

    const labels = meses.map(x => `${UIHelpers.MESES_ABREV[x.mes - 1]} ${String(x.anio).slice(-2)}`);

    return { meses, labels, ingresos, gastos };
  }

  /** Desglose por categoría de un mes concreto (anio, mes 1-12) dentro de la ventana ya cargada. */
  function getCategoryBreakdownMes(anio, mes) {
    const items = {};
    let total = 0;

    historico.forEach(m => {
      const f = new Date(m.fecha);
      if (f.getFullYear() !== anio || f.getMonth() + 1 !== mes) return;

      const efecto = m.tipo === 'expense' ? m.importe : -m.importe;
      total += efecto;

      if (!items[m.cat]) {
        items[m.cat] = { nombre: m.cat, gastado: 0 };
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
    cargarHistorico,
    getFechaMinima,
    buscarMovimientos,
    getVentanaMeses,
    getCategoryBreakdownMes,
  };

})();
