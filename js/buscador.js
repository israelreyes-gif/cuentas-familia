/**
 * js/buscador.js
 * -----------------------------------------------------------------------
 * Pestaña "Buscador": busca en TODO el histórico de movimientos (no solo
 * el mes en curso, que es a lo único que llega la pestaña Movimiento).
 * Filtros por texto (descripción), categoría, tipo y rango de fechas.
 * Máximo 100 resultados, del más reciente al más antiguo. Es solo
 * consulta — no se puede editar ni borrar nada desde aquí.
 * -----------------------------------------------------------------------
 */

const Buscador = (function () {

  let categoriasCargadas = false;

  function formatFecha(fechaStr) {
    const f = new Date(fechaStr);
    return `${f.getDate()} ${UIHelpers.MESES_ABREV[f.getMonth()].toLowerCase()} ${f.getFullYear()}`;
  }

  /** Rellena el desplegable de categorías una sola vez (no cambia mientras la app está abierta). */
  function cargarCategorias() {
    if (categoriasCargadas) return;
    const select = document.getElementById('buscarCategoria');
    if (!select) return;

    const opciones = AppData.getCategoriasOrdenadas()
      .map(c => `<option value="${c.id}">${UIHelpers.escapeHtml(c.nombre)}</option>`)
      .join('');
    select.innerHTML = '<option value="">Todas las categorías</option>' + opciones;
    categoriasCargadas = true;
  }

  function init() {
    cargarCategorias();
  }

  function renderResultados(lista) {
    const el = document.getElementById('buscarResultados');
    const resumen = document.getElementById('buscarResumen');
    if (!el) return;

    if (lista.length === 0) {
      el.innerHTML = '<div class="empty-note">No se han encontrado movimientos.</div>';
      if (resumen) resumen.textContent = '';
      return;
    }

    if (resumen) {
      resumen.textContent = lista.length >= 100
        ? 'Mostrando los 100 resultados más recientes'
        : `${lista.length} resultado${lista.length === 1 ? '' : 's'}`;
    }

    el.innerHTML = lista.map(m => `
      <div class="ledger-row">
        <span class="cat-icon">${CategoryIcons.render(m.cat)}</span>
        <div class="ledger-main">
          <div class="ledger-desc">${UIHelpers.escapeHtml(m.desc)}</div>
          <div class="ledger-cat">${UIHelpers.escapeHtml(m.cat)} · ${formatFecha(m.fecha)}</div>
        </div>
        <div class="ledger-amt ${m.tipo}">${m.tipo === 'income' ? '+' : '−'} ${UIHelpers.formatMoney(m.importe)}</div>
      </div>
    `).join('');
  }

  function buscar() {
    const btn = document.getElementById('buscarBtn');
    const texto = document.getElementById('buscarTexto').value.trim();
    const categoriaId = document.getElementById('buscarCategoria').value;
    const tipo = document.getElementById('buscarTipo').value;
    const desde = document.getElementById('buscarDesde').value;
    const hasta = document.getElementById('buscarHasta').value;

    UIHelpers.setButtonLoading(btn, true, '<span class="spinner on-dark"></span> Buscando...');

    AppData.buscarMovimientos({ texto, categoriaId, tipo, desde, hasta })
      .then((resultados) => {
        renderResultados(resultados);
      })
      .catch((err) => {
        UIHelpers.showToast(err.message || 'No se pudo realizar la búsqueda.');
      })
      .finally(() => {
        UIHelpers.setButtonLoading(btn, false);
      });
  }

  return {
    init,
    buscar,
  };

})();
