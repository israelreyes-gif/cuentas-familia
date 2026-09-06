/**
 * js/grafica.js
 * -----------------------------------------------------------------------
 * Pestaña "Gráfica": ingresos frente a gastos de los últimos 12 meses,
 * con:
 *   - navegación mes a mes (flechas ‹ ›) — no por año: la ventana
 *     siempre muestra 12 meses seguidos terminando en el mes elegido
 *   - al entrar en la pestaña se muestra la ventana que termina en el
 *     mes actual, con su resumen (ingresos/gastos/ahorro neto)
 *   - un toque sobre un mes → resumen; doble toque → detalle por categoría
 *
 * Cada cambio de mes pide al servidor (vía AppData.cargarHistorico) los
 * movimientos de esa ventana de 12 meses — no se guarda todo el
 * histórico en memoria de golpe.
 *
 * Depende de:
 *   - AppData    (js/data.js)        → carga y cálculo de la ventana de 12 meses
 *   - UIHelpers  (js/ui-helpers.js)  → spinners, overlays, formato de dinero, meses
 *   - Chart      (librería externa Chart.js, cargada antes que este fichero)
 * -----------------------------------------------------------------------
 */

const Grafica = (function () {

  const COLOR_INCOME = '#1E8A63';
  const COLOR_EXPENSE = '#C1443D';
  const COLOR_NET = '#B7912B';
  const DOUBLE_TAP_MS = 320;

  let mesFin = null; // { anio, mes } — último mes de la ventana de 12 meses actualmente mostrada
  let chart = null;
  let lastTapTime = 0;
  let lastTapIndex = null;
  let tapTimeout = null;

  // ---- utilidades internas ----

  function esMesActual(anio, mes) {
    const hoy = new Date();
    return anio === hoy.getFullYear() && mes === hoy.getMonth() + 1;
  }

  /** Primer mes de la ventana de 12 meses que termina en anio-mes. */
  function inicioVentana(anio, mes) {
    let m = mes - 11;
    let a = anio;
    while (m < 1) { m += 12; a -= 1; }
    return { anio: a, mes: m };
  }

  function mostrarOverlayCarga() {
    const container = document.querySelector('.chart-wrap');
    if (!container) return null;
    container.style.position = container.style.position || 'relative';
    const overlay = document.createElement('div');
    overlay.className = 'loading-overlay';
    overlay.innerHTML = '<span class="spinner"></span>';
    container.appendChild(overlay);
    return overlay;
  }

  // ---- gráfico ----

  function buildOrUpdateChart() {
    const v = AppData.getVentanaMeses();
    const gastosNeg = v.gastos.map(x => -x);
    const netoData = v.labels.map((_, i) => v.ingresos[i] - v.gastos[i]);

    if (!chart) {
      const ctx = document.getElementById('mainChart').getContext('2d');
      chart = new Chart(ctx, {
        data: {
          labels: v.labels,
          datasets: [
            { type: 'bar', label: 'Ingresos', data: v.ingresos, backgroundColor: COLOR_INCOME, borderRadius: 5, barPercentage: .6, order: 2 },
            { type: 'bar', label: 'Gastos', data: gastosNeg, backgroundColor: COLOR_EXPENSE, borderRadius: 5, barPercentage: .6, order: 2 },
            { type: 'line', label: 'Ahorro neto', data: netoData, borderColor: COLOR_NET, backgroundColor: COLOR_NET,
              borderWidth: 2.5, pointRadius: 4, pointBackgroundColor: COLOR_NET, tension: .3, order: 1 }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false }, tooltip: { enabled: false } },
          scales: {
            x: { grid: { display: false }, ticks: { font: { family: 'Inter', size: 11 }, color: '#334339' } },
            y: {
              grid: { color: '#EDE6D2' },
              ticks: {
                font: { family: 'IBM Plex Mono', size: 10 }, color: '#334339',
                callback: (v) => (Math.abs(v) >= 1000 ? (v / 1000) + 'k' : v)
              }
            }
          },
          onClick: (evt) => handleChartTap(evt)
        }
      });
    } else {
      chart.data.labels = v.labels;
      chart.data.datasets[0].data = v.ingresos;
      chart.data.datasets[1].data = gastosNeg;
      chart.data.datasets[2].data = netoData;
      chart.update();
    }
  }

  // ---- navegación mes a mes ----

  function actualizarFlechas() {
    const inicio = inicioVentana(mesFin.anio, mesFin.mes);
    const fechaMin = AppData.getFechaMinima();
    const puedeRetroceder = !fechaMin
      || inicio.anio > fechaMin.anio
      || (inicio.anio === fechaMin.anio && inicio.mes > fechaMin.mes);

    document.getElementById('yearLabel').textContent = `${UIHelpers.MESES_LARGO[mesFin.mes - 1]} ${mesFin.anio}`;
    document.getElementById('yearPrev').disabled = !puedeRetroceder;
    document.getElementById('yearNext').disabled = esMesActual(mesFin.anio, mesFin.mes);
  }

  function changeMonth(delta) {
    let mes = mesFin.mes + delta;
    let anio = mesFin.anio;
    while (mes < 1) { mes += 12; anio -= 1; }
    while (mes > 12) { mes -= 12; anio += 1; }

    const hoy = new Date();
    const esFuturo = anio > hoy.getFullYear() || (anio === hoy.getFullYear() && mes > hoy.getMonth() + 1);
    if (esFuturo) return;

    mesFin = { anio, mes };
    lastTapIndex = null;
    cargarYRenderizar();
  }

  async function cargarYRenderizar() {
    actualizarFlechas();
    const overlay = mostrarOverlayCarga();
    try {
      await AppData.cargarHistorico(mesFin.anio, mesFin.mes);
      actualizarFlechas();
      buildOrUpdateChart();
      showMonthInfo(mesFin.anio, mesFin.mes);
    } finally {
      if (overlay) overlay.remove();
    }
  }

  // ---- toque simple = resumen del mes · doble toque = drill-down por categoría ----

  function handleChartTap(evt) {
    if (!chart) return;
    const points = chart.getElementsAtEventForMode(evt, 'index', { intersect: false }, true);
    if (!points.length) return;

    const idx = points[0].index;
    const ventana = AppData.getVentanaMeses();
    const punto = ventana.meses[idx];
    if (!punto) return;

    const now = Date.now();

    if (lastTapIndex === idx && (now - lastTapTime) < DOUBLE_TAP_MS) {
      clearTimeout(tapTimeout);
      lastTapIndex = null;
      openDrilldown(punto.anio, punto.mes);
      return;
    }

    lastTapTime = now;
    lastTapIndex = idx;
    clearTimeout(tapTimeout);
    tapTimeout = setTimeout(() => showMonthInfo(punto.anio, punto.mes), DOUBLE_TAP_MS);
  }

  function showMonthInfo(anio, mes) {
    const ventana = AppData.getVentanaMeses();
    const idx = ventana.meses.findIndex(x => x.anio === anio && x.mes === mes);
    if (idx === -1) return;

    const ingresos = ventana.ingresos[idx];
    const gastos = ventana.gastos[idx];
    const neto = ingresos - gastos;

    document.getElementById('monthInfoTitle').textContent = `${UIHelpers.MESES_LARGO[mes - 1]} ${anio}`;
    document.getElementById('miIngresos').textContent = UIHelpers.formatMoney(ingresos);
    document.getElementById('miGastos').textContent = UIHelpers.formatMoney(gastos);

    const netoEl = document.getElementById('miNeto');
    netoEl.textContent = (neto >= 0 ? '+' : '') + UIHelpers.formatMoney(neto);
    netoEl.className = 'mi-amt ' + (neto >= 0 ? 'income' : 'expense');

    document.getElementById('monthInfo').classList.remove('hidden');
  }

  // ---- drill-down por categoría ----

  function openDrilldown(anio, mes) {
    document.getElementById('graf-chart-screen').classList.add('hidden');
    document.getElementById('graf-drill-screen').style.display = 'block';

    document.getElementById('drillTitle').textContent = `${UIHelpers.MESES_LARGO[mes - 1]} ${anio}`;
    document.getElementById('drillTotal').textContent = '···';

    UIHelpers.withOverlay(document.getElementById('drillList'), 300, () => {
      const { total, items } = AppData.getCategoryBreakdownMes(anio, mes);
      document.getElementById('drillTotal').textContent = UIHelpers.formatMoney(total);
      document.getElementById('drillList').innerHTML = items.map(it => {
        const pct = total > 0 ? Math.max(0, Math.min(100, Math.round(it.gastado / total * 100))) : 0;
        return `
          <div class="cat-row">
            <div class="cat-top">
              <div class="cat-name"><span class="cat-icon">${CategoryIcons.render(it.nombre)}</span>${UIHelpers.escapeHtml(it.nombre)}</div>
              <div class="cat-nums">${UIHelpers.formatMoney(it.gastado)} · ${pct}%</div>
            </div>
            <div class="cat-bar-bg"><div class="cat-bar-fill" style="width:${pct}%"></div></div>
          </div>
        `;
      }).join('');
    });
  }

  function closeDrilldown() {
    document.getElementById('graf-drill-screen').style.display = 'none';
    document.getElementById('graf-chart-screen').classList.remove('hidden');
  }

  /**
   * Se llama cada vez que se entra en la pestaña Gráfica (no solo la
   * primera vez). La primera vez elige la ventana que termina en el mes
   * actual; las siguientes veces mantiene el mes que el usuario tuviera
   * seleccionado. Siempre vuelve a pedir los datos y a redibujar.
   */
  function show() {
    if (mesFin === null) {
      const hoy = new Date();
      mesFin = { anio: hoy.getFullYear(), mes: hoy.getMonth() + 1 };
    }
    closeDrilldown();
    lastTapIndex = null;
    cargarYRenderizar();
  }

  // ---- API pública del módulo ----
  return {
    show,
    changeMonth,
    closeDrilldown,
  };

})();
