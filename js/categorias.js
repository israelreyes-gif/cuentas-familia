/**
 * js/categorias.js
 * -----------------------------------------------------------------------
 * Pestaña "Categorías": gasto del mes por categoría + administración
 * (añadir, editar presupuesto, marcar como fija, eliminar).
 * -----------------------------------------------------------------------
 */

const Categorias = (function () {

  let selectedColor = AppData.getColorPalette()[0];

  function formatMoney(valor) {
    return valor.toFixed(2).replace('.', ',') + ' €';
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function escapeJsString(str) {
    return String(str).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  }

  function renderSpendList() {
    const list = document.getElementById('catSpendList');
    if (!list) return;

    const cats = AppData.getCategoriasConGasto();
    if (cats.length === 0) {
      list.innerHTML = '<div class="empty-note">No hay gasto registrado este mes.</div>';
    } else {
      list.innerHTML = cats.map(c => {
        const sinPresupuesto = !c.presupuesto || c.presupuesto <= 0;
        const pct = sinPresupuesto ? 0 : Math.min(100, Math.round(c.gastado / c.presupuesto * 100));
        return `
          <div class="cat-row">
            
