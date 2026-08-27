/**
 * js/movimientos.js
 * -----------------------------------------------------------------------
 * Pestaña "Movimientos": alta de ingresos/gastos, listado tipo ledger, y
 * cabecera con saldo/ingresos/gastos del mes en curso — todo calculado
 * siempre a partir de los datos reales de AppData, nunca de valores fijos.
 *
 * Depende de:
 *   - AppData    (js/data.js)        → leer/guardar movimientos y categorías
 *   - UIHelpers  (js/ui-helpers.js)  → spinners y overlays de carga
 * -----------------------------------------------------------------------
 */

const Movimientos = (function () {

  const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const MESES_ABREV = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

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

  // ---- cabecera: saldo del mes en curso, calculado siempre a partir de datos reales ----

  function renderHeader() {
    const hoy = new Date();
    const movimientos = AppData.getMovimientos().filter(m => {
      const f = new Date(m.fecha);
      return f.getFullYear() === hoy.getFullYear() && f.getMonth() === hoy.getMonth();
    });

    const ingresos = movimientos.filter(m => m.tipo === 'income').reduce((sum, m) => sum + m.importe, 0);
    const gastos = movimientos.filter(m => m.tipo === 'expense').reduce((sum, m) => sum + m.importe, 0);
    const saldo = ingresos - gastos;

    const balanceEl = document.getElementById('balanceAmount');
    if (balanceEl) {
      balanceEl.textContent = (saldo >= 0 ? '+' : '') + formatMoney(saldo);
      balanceEl.classList.toggle('positive', saldo >= 0);
    }

    const subEl = document.querySelector('.balance-sub');
    if (subEl) {
      subEl.textContent = `Ingresos ${formatMoney(ingresos)} · Gastos ${formatMoney(gastos)}`;
    }

    const eyebrowEl = document.querySelector('.cover-eyebrow');
    if (eyebrowEl) {
      eyebrowEl.textContent = `Libro de cuentas · ${capitalize(MESES[hoy.getMonth()])} ${hoy.getFullYear()}`;
    }

    const ledgerMonthEl = document.querySelector('.ledger-heading span');
    if (ledgerMonthEl) {
      ledgerMonthEl.textContent = `${MESES_ABREV[hoy.getMonth()]} ${hoy.getFullYear()}`;
    }
  }

  function capitalize(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
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
        <button class="ledger-delete" onclick="Movimientos.deleteMovement(${m.id}, this)" aria-label="Eliminar movimiento">✕</button>
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
    const amountVal = parseFloat(amountInput.value);
    const descVal = descInput.value.trim();
    const catVal = catSelect.value;
    const fechaVal = (dateInput && dateInput.value) || new Date().toISOString().slice(0, 10);

    // Validación real: sin importe válido o sin descripción, no se inventa
    // ningún valor por defecto — se avisa y no se guarda nada.
    let huboError = false;
    if (!amountVal || amountVal <= 0) {
      amountInput.style.borderColor = 'var(--expense)';
      huboError = true;
    } else {
      amountInput.style.borderColor = '';
    }
    if (!descVal) {
      descInput.style.borderColor = 'var(--expense)';
      huboError = true;
    } else {
      descInput.style.borderColor = '';
    }
    if (huboError) return;

    UIHelpers.setButtonLoading(btn, true, '<span class="spinner on-dark"></span> Guardando...');

    AppData.addMovimiento({ desc: descVal, cat: catVal, tipo, importe: amountVal, fecha: fechaVal })
      .then(() => {
        UIHelpers.withOverlay(document.getElementById('ledgerList'), 250, () => {
          renderLedgerList();
        });
        renderHeader();

        UIHelpers.setButtonLoading(btn, true, '✓ Guardado');
        setTimeout(() => {
          UIHelpers.setButtonLoading(btn, false);
          amountInput.value = '';
          descInput.value = '';
        }, 800);
      })
      .catch((err) => {
        UIHelpers.setButtonLoading(btn, false);
        alert(err.message || 'No se pudo guardar el movimiento.');
      });
  }

  function deleteMovement(id, btn) {
    if (!confirm('¿Eliminar este movimiento?')) return;

    UIHelpers.setButtonLoading(btn, true, '<span class="spinner"></span>');

    AppData.deleteMovimiento(id)
      .then(() => {
        renderLedgerList();
        renderHeader();
      })
      .catch((err) => {
        UIHelpers.setButtonLoading(btn, false);
        alert(err.message || 'No se pudo eliminar el movimiento.');
      });
  }

  // ---- arranque del módulo ----

  function init() {
    renderCategorySelect();
    renderHeader();
    UIHelpers.withOverlay(document.getElementById('ledgerList'), 300, () => {
      renderLedgerList();
    });
  }

  // ---- API pública del módulo ----
  return {
    init,
    renderLedgerList,
    renderCategorySelect,
    renderHeader,
    setType,
    saveMovement,
    deleteMovement,
  };

})();
