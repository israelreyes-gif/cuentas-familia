/**
 * js/movimientos.js
 * -----------------------------------------------------------------------
 * Pestaña "Movimientos": alta de ingresos/gastos, listado tipo ledger, y
 * cabecera con el saldo acumulado real (saldo inicial + todos los
 * movimientos desde siempre) — no un saldo que resetea cada mes.
 * -----------------------------------------------------------------------
 */

const Movimientos = (function () {

  const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const MESES_ABREV = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

  function formatMoney(valor) {
    return valor.toFixed(2).replace('.', ',') + ' €';
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function getTodayISO() {
    const hoy = new Date();
    const offset = hoy.getTimezoneOffset() * 60000;
    return new Date(hoy - offset).toISOString().slice(0, 10);
  }

  function renderHeader() {
    const hoy = new Date();

    // Saldo acumulado real (saldo inicial + todo el historial) — no resetea cada mes.
    const saldoActual = AppData.getSaldoActual();

    const balanceEl = document.getElementById('balanceAmount');
    if (balanceEl) {
      balanceEl.textContent = (saldoActual >= 0 ? '+' : '') + formatMoney(saldoActual);
      balanceEl.classList.toggle('positive', saldoActual >= 0);
    }

    // Ingresos/gastos DEL MES EN CURSO, solo informativo — el saldo de arriba no depende de esto.
    const movimientosDelMes = AppData.getMovimientos().filter(m => {
      const f = new Date(m.fecha);
      return f.getFullYear() === hoy.getFullYear() && f.getMonth() === hoy.getMonth();
    });
    const ingresosMes = movimientosDelMes.filter(m => m.tipo === 'income').reduce((sum, m) => sum + m.importe, 0);
    const gastosMes = movimientosDelMes.filter(m => m.tipo === 'expense').reduce((sum, m) => sum + m.importe, 0);

    const subEl = document.querySelector('.balance-sub');
    if (subEl) {
      subEl.textContent = `Ingresos ${formatMoney(ingresosMes)} · Gastos ${formatMoney(gastosMes)}`;
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

  function resetDateField() {
    const dateInput = document.getElementById('dateInput');
    if (dateInput) dateInput.value = getTodayISO();
  }

  function renderCategorySelect() {
    const select = document.getElementById('categorySelect');
    if (!select) return;
    const opciones = AppData.getCategoriasParaGasto()
      .map(c => `<option value="${escapeHtml(c.nombre)}">${escapeHtml(c.nombre)}</option>`)
      .join('');
    select.innerHTML = `<option value="" disabled selected>Selecciona una categoría</option>` + opciones;
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

  function setType(type) {
    document.getElementById('btnExpense').classList.toggle('selected', type === 'expense');
    document.getElementById('btnIncome').classList.toggle('selected', type === 'income');
  }

  function saveMovement() {
    const btn = document.getElementById('saveMovBtn');
    const amountInput = document.getElementById('amountInput');
    const descInput = document.getElementById('descInput');
    const catSelect = document.getElementById('categorySelect');
    const dateInput = document.getElementById('dateInput');

    const tipo = document.getElementById('btnExpense').classList.contains('selected') ? 'expense' : 'income';
    const amountVal = parseFloat(amountInput.value);
    const descVal = descInput.value.trim();
    const catVal = catSelect.value;
    const fechaVal = (dateInput && dateInput.value) || getTodayISO();

    let huboError = false;
    if (!amountVal || amountVal <= 0) {
      amountInput.style.borderColor = 'var(--expense)';
      huboError = true;
    } else {
      amountInput.style.borderColor = '';
    }
    if (!catVal) {
      catSelect.style.borderColor = 'var(--expense)';
      huboError = true;
    } else {
      catSelect.style.borderColor = '';
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
          catSelect.value = '';
          resetDateField();
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

  function init() {
    renderCategorySelect();
    resetDateField();
    renderHeader();
    UIHelpers.withOverlay(document.getElementById('ledgerList'), 300, () => {
      renderLedgerList();
    });
  }

  return {
    init,
    renderLedgerList,
    renderCategorySelect,
    renderHeader,
    resetDateField,
    setType,
    saveMovement,
    deleteMovement,
  };

})();
