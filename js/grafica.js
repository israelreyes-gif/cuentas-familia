/**
 * js/grafica.js
 * -----------------------------------------------------------------------
 * Pestaña "Gráfica": ingresos frente a gastos por año, con:
 *   - navegación entre años (flechas)
 *   - un toque sobre un mes → resumen (ingresos / gastos / ahorro neto)
 *   - doble toque sobre el mismo mes → detalle de gasto por categoría
 *
 * Depende de:
 *   - AppData    (js/data.js)        → datos de la gráfica y desglose por categoría
 *   - UIHelpers  (js/ui-helpers.js)  → spinners y overlays de carga
 *   - Chart      (librería externa Chart.js, cargada antes que este fichero)
 * -----------------------------------------------------------------------
 */

const Grafica = (function () {

  const COLOR_INCOME = '#1E8A63';
  const COLOR_EXPENSE = '#C1443D';
  const COLOR_NET = '#B7912B';
  const DOUBLE_TAP_MS = 320;

  let currentYear = null;
  let chart = null;
  let lastTapTime = 0;
  let lastTapIndex = null;
  let tapTimeout = null;

  // ---- utilidades internas ----

  function formatMoney(valor) {
    return valor.toFixed(2).replace('.', ',') + ' €';
  }

  /** Evita inyectar HTML si el nombre de categoría contiene < > etc. */
  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ---- gráfico ----

  function buildOrUpdateChart() {
    const d = AppData.getYearData(currentYear);
    const gastosNeg = d.gastos.map(v => -v);
    const netoData = d.labels.map((_, i) => d.ingresos[i] - d.gastos[i]);

    if (!chart) {
      const ctx = document.getElementById('mainChart').getContext('2d');
      chart = new Chart(ctx, {
        data: {
          labels: d.labels,
          datasets: [
            { type: 'bar', label: 'Ingresos', data: d.ingresos, backgroundColor: COLOR_INCOME, borderRadius: 5, barPercentage: .6, order: 2 },
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
      chart.data.labels = d.labels;
      chart.data.datasets[0].data = d.ingresos;
      chart.data.datasets[1].data = gastosNeg;
      chart.data.datasets[2].data = netoData;
      chart.update();
    }
  }

  // ---- navegación por años ----

  function updateYearArrows() {
    const years = AppData.getAvailableYears();
    const idx = years.indexOf(currentYear);
    document.getElementById('yearLabel').textContent = currentYear;
    document.getElementById('yearPrev').disabled = (idx === 0);
    document.getElementById('yearNext').disabled = (idx === years.length - 1);
  }

  function changeYear(delta) {
    const years = AppData.getAvailableYears();
    const idx = years.indexOf(currentYear);
    const newIdx = idx + delta;
    if (newIdx < 0 || newIdx >= years.length) return;

    currentYear = years[newIdx];
    updateYearArrows();
    document.getElementById('monthInfo').classList.add('hidden');
    lastTapIndex = null;

    UIHelpers.withOverlay(document.querySelector('.chart-wrap'), 400, () => {
      buildOrUpdateChart();
    });
  }

  // ---- toque simple = resumen del mes · doble toque = drill-down por categoría ----

  function handleChartTap(evt) {
    if (!chart) return;
    const points = chart.getElementsAtEventForMode(evt, 'index', { intersect: false }, true);
    if (!points.length) return;

    const idx = points[0].index;
    const now = Date.now();

    if (lastTapIndex === idx && (now - lastTapTime) < DOUBLE_TAP_MS) {
      clearTimeout(tapTimeout);
      lastTapIndex = null;
      openDrilldown(currentYear, idx);
      return;
    }

    lastTapTime = now;
    lastTapIndex = idx;
    clearTimeout(tapTimeout);
    tapTimeout = setTimeout(() => showMonthInfo(currentYear, idx), DOUBLE_TAP_MS);
  }

  function showMonthInfo(year, monthIndex) {
    const d = AppData.getYearData(year);
    const ingresos = d.ingresos[monthIndex];
    const gastos = d.gastos[monthIndex];
    const neto = ingresos - gastos;

    document.getElementById('monthInfoTitle').textContent = `${d.labels[monthIndex]} ${year}`;
    document.getElementById('miIngresos').textContent = formatMoney(ingresos);
    document.getElementById('miGastos').textContent = formatMoney(gastos);

    const netoEl = document.getElementById('miNeto');
    netoEl.textContent = (neto >= 0 ? '+' : '') + formatMoney(neto);
    netoEl.className = 'mi-amt ' + (neto >= 0 ? 'income' : 'expense');

    document.getElementById('monthInfo').classList.remove('hidden');
  }

  // ---- drill-down por categoría ----

  function openDrilldown(year, monthIndex) {
    document.getElementById('graf-chart-screen').classList.add('hidden');
    document.getElementById('graf-drill-screen').style.display = 'block';

    const d = AppData.getYearData(year);
    document.getElementById('drillTitle').textContent = `${d.labels[monthIndex]} ${year}`;
    document.getElementById('drillTotal').textContent = '···';

    UIHelpers.withOverlay(document.getElementById('drillList'), 450, () => {
      const { total, items } = AppData.getCategoryBreakdown(year, monthIndex);
      document.getElementById('drillTotal').textContent = formatMoney(total);
      document.getElementById('drillList').innerHTML = items.map(it => {
        const pct = total > 0 ? Math.round(it.gastado / total * 100) : 0;
        return `
          <div class="cat-row">
            <div class="cat-top">
              <div class="cat-name"><span class="cat-swatch" style="background:${it.color}"></span>${escapeHtml(it.nombre)}</div>
              <div class="cat-nums">${formatMoney(it.gastado)} · ${pct}%</div>
            </div>
            <div class="cat-bar-bg"><div class="cat-bar-fill" style="width:${pct}%; background:${it.color}"></div></div>
          </div>
        `;
      }).join('');
    });
  }

  function closeDrilldown() {
    document.getElementById('graf-drill-screen').style.display = 'none';
    document.getElementById('graf-chart-screen').classList.remove('hidden');
  }

  // ---- arranque y reinicio del módulo ----

  function init() {
    const years = AppData.getAvailableYears();
    currentYear = years[years.length - 1]; // el año más reciente, por defecto
    updateYearArrows();
    UIHelpers.withOverlay(document.querySelector('.chart-wrap'), 300, () => {
      buildOrUpdateChart();
    });
  }

  /** Se llama cada vez que se entra en la pestaña, por si se quedó el drill-down abierto. */
  function reset() {
    closeDrilldown();
    document.getElementById('monthInfo').classList.add('hidden');
    lastTapIndex = null;
  }

  // ---- API pública del módulo ----
  return {
    init,
    reset,
    changeYear,
    closeDrilldown,
  };

})();
