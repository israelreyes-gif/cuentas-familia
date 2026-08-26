/**
 * js/movimientos.js
 * -----------------------------------------------------------------------
 * Pestaña "Movimientos": alta de ingresos/gastos y listado tipo ledger.
 *
 * Depende de:
 *   - AppData    (js/data.js)        → leer/guardar movimientos y categorías
 *   - UIHelpers  (js/ui-helpers.js)  → spinners y overlays de carga
 * -----------------------------------------------------------------------
 */

const Movimientos = (function () {

  // ---- utilidades internas ----

  function formatMoney(valor) {
    return valor.toFixed(2).replace('.', ',') + ' €';
  }

  /** Evita inyectar HTML si la descripción escrita por el usuario contiene < > etc. */
  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ---- pintado ----

  function renderCategorySelect() {
    const select = document.getElementById('categorySelect');
    if (!select) return;
    select.innerHTML = AppData.getCategoriasOrdenadas()
      .map(c => `<option>${escapeHtml(c.nombre)}</option>`)
      .join('');
  }

  function renderLedgerList() {
    const list = document.getElementById('ledgerList');
    if (!list) return;

    const movimientos = AppData.getMovimientos();
    if (movimientos.length === 0) {
      list.innerHTML = '<div class="empty-note">Todavía no hay movimientos.</div>';
      return;
    }

    list.innerHTML = movimientos.map(m => `
      <div class="ledger-row">
        <span class="ledger-dot ${m.tipo}"></span>
        <div class="ledger-main">
          <div class="ledger-desc">${escapeHtml(m.desc)}</div>
          <div class="ledger-cat">${escapeHtml(m.cat)}</div>
        </div>
        <div class="ledger-amt ${m.tipo}">${m.tipo === 'income' ? '+' : '−'} ${formatMoney(m.importe)}</div>
      </div>
    `).join('');
  }

  // ---- interacción ----

  /** Alterna el tipo de movimiento (Gasto / Ingreso) en el formulario. */
  function setType(type) {
    document.getElementById('btnExpense').classList.toggle('selected', type === 'expense');
    document.getElementById('btnIncome').classList.toggle('selected', type === 'income');
  }

  function saveMovement() {
    const btn = document.getElementById('saveMovBtn');
    const amountInput = document.getElementById('amountInput');
    const descInput = document.getElementById('descInput');
    const catSelect = document.getElementById('categorySelect');
    const dateInput = document.querySelector('#view-mov input[type="date"]');

    const tipo = document.getElementById('btnExpense').classList.contains('selected') ? 'expense' : 'income';
    const amountVal = parseFloat(amountInput.value) || (tipo === 'income' ? 100 : 25);
    const descVal = descInput.value.trim() || (tipo === 'income' ? 'Ingreso' : 'Gasto');
    const catVal = catSelect.value;
    const fechaVal = (dateInput && dateInput.value) || new Date().toISOString().slice(0, 10);

    UIHelpers.setButtonLoading(btn, true, '<span class="spinner on-dark"></span> Guardando...');

    AppData.addMovimiento({ desc: descVal, cat: catVal, tipo, importe: amountVal, fecha: fechaVal })
      .then(() => {
        UIHelpers.withOverlay(document.getElementById('ledgerList'), 250, () => {
          renderLedgerList();
        });

        UIHelpers.setButtonLoading(btn, true, '✓ Guardado');
        setTimeout(() => {
          UIHelpers.setButtonLoading(btn, false);
          amountInput.value = '';
          descInput.value = '';
        }, 800);
      })
      .catch((err) => {
        UIHelpers.setButtonLoading(btn, false);
        alert(err.message || 'No se pudo guardar el movimiento. Comprueba tu conexión.');
      });
  }

  // ---- arranque del módulo ----

  function init() {
    renderCategorySelect();
    UIHelpers.withOverlay(document.getElementById('ledgerList'), 300, () => {
      renderLedgerList();
    });
  }

  // ---- API pública del módulo ----
  return {
    init,
    renderLedgerList,
    renderCategorySelect,
    setType,
    saveMovement,
  };

})();
