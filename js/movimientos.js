/**
 * js/movimientos.js
 * -----------------------------------------------------------------------
 * Pestaña "Movimientos": alta de ingresos/gastos, listado tipo ledger, y
 * cabecera con el saldo acumulado real (saldo inicial + todos los
 * movimientos desde siempre) — no un saldo que resetea cada mes.
 * -----------------------------------------------------------------------
 */

const Movimientos = (function () {

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
      balanceEl.textContent = (saldoActual >= 0 ? '+' : '') + UIHelpers.formatMoney(saldoActual);
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
      subEl.textContent = `Ingresos ${UIHelpers.formatMoney(ingresosMes)} · Gastos ${UIHelpers.formatMoney(gastosMes)}`;
    }

    const eyebrowEl = document.querySelector('.cover-eyebrow');
    if (eyebrowEl) {
      eyebrowEl.textContent = `Libro de cuentas · ${UIHelpers.MESES_LARGO[hoy.getMonth()]} ${hoy.getFullYear()}`;
    }

    const ledgerMonthEl = document.querySelector('.ledger-heading span');
    if (ledgerMonthEl) {
      ledgerMonthEl.textContent = `${UIHelpers.MESES_ABREV[hoy.getMonth()].toLowerCase()} ${hoy.getFullYear()}`;
    }
  }

  function resetDateField() {
    const dateInput = document.getElementById('dateInput');
    if (dateInput) dateInput.value = getTodayISO();
  }

  function renderCategorySelect() {
    const select = document.getElementById('categorySelect');
    if (!select) return;
    const opciones = AppData.getCategoriasParaGasto()
      .map(c => `<option value="${UIHelpers.escapeHtml(c.nombre)}">${UIHelpers.escapeHtml(c.nombre)}</option>`)
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
        <span class="cat-icon">${CategoryIcons.render(m.cat)}</span>
        <div class="ledger-main">
          <div class="ledger-desc">${UIHelpers.escapeHtml(m.desc)}</div>
          <div class="ledger-cat">${UIHelpers.escapeHtml(m.cat)}</div>
        </div>
        <div class="ledger-amt ${m.tipo}">${m.tipo === 'income' ? '+' : '−'} ${UIHelpers.formatMoney(m.importe)}</div>
        <button class="ledger-delete" onclick="Movimientos.deleteMovement(${m.id}, this)" aria-label="Eliminar movimiento">✕</button>
      </div>
    `).join('');
  }

  function renderUpcomingFixed() {
    const el = document.getElementById('upcomingFixed');
    if (!el) return;

    const meses = AppData.getProximosGastosFijos();

    el.innerHTML = `
      <div class="upcoming-fixed-heading">Próximos gastos fijos</div>
      <div class="upcoming-months">
        ${meses.map(m => `
          <div class="upcoming-month-card">
            <div class="upcoming-month-name">${m.mes} ${m.anio}</div>
            <div class="upcoming-month-total">${UIHelpers.formatMoney(m.total)}</div>
            ${m.categorias.length === 0
              ? '<div class="upcoming-empty">Sin gastos fijos</div>'
              : m.categorias.map(c => `
                  <div class="upcoming-cat-row">
                    <span class="cat-icon">${CategoryIcons.render(c.nombre)}</span>
                    <span class="upcoming-cat-name">${UIHelpers.escapeHtml(c.nombre)}</span>
                    <span class="upcoming-cat-amt">${c.presupuesto} €</span>
                  </div>
                `).join('')
            }
          </div>
        `).join('')}
      </div>
    `;
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
        UIHelpers.showToast(err.message || 'No se pudo guardar el movimiento.');
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
        UIHelpers.showToast(err.message || 'No se pudo eliminar el movimiento.');
      });
  }

  function init() {
    renderCategorySelect();
    resetDateField();
    renderHeader();
    renderUpcomingFixed();
    UIHelpers.withOverlay(document.getElementById('ledgerList'), 300, () => {
      renderLedgerList();
    });
  }

  return {
    init,
    renderLedgerList,
    renderCategorySelect,
    renderHeader,
    renderUpcomingFixed,
    resetDateField,
    setType,
    saveMovement,
    deleteMovement,
  };

})();
