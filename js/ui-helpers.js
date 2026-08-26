/**
 * js/ui-helpers.js
 * -----------------------------------------------------------------------
 * Ayudas de UI reutilizables para dar feedback de carga en cualquier
 * acción (guardar, añadir, borrar, cambiar de año, abrir un detalle...).
 *
 * No conoce nada de movimientos, categorías ni gráfica: solo sabe mostrar
 * y quitar spinners. El resto de módulos lo usan así:
 *
 *   UIHelpers.withOverlay(contenedor, 400, () => { ...repintar... });
 *   UIHelpers.setButtonLoading(boton, true);
 *   UIHelpers.withFieldLoading(input, 400, () => { ...guardar valor... });
 * -----------------------------------------------------------------------
 */

const UIHelpers = (function () {

  /**
   * Cubre `container` con un overlay + spinner durante `ms` milisegundos
   * y luego lo quita y ejecuta `callback` (normalmente, ahí es donde se
   * repinta el contenido ya actualizado).
   */
  function withOverlay(container, ms, callback) {
    if (!container) { callback(); return; }

    container.style.position = container.style.position || 'relative';
    const overlay = document.createElement('div');
    overlay.className = 'loading-overlay';
    overlay.innerHTML = '<span class="spinner"></span>';
    container.appendChild(overlay);

    setTimeout(() => {
      overlay.remove();
      callback();
    }, ms);
  }

  /**
   * Pone/quita el estado de carga de un botón, guardando su contenido
   * original para poder restaurarlo exactamente al terminar.
   *
   *   UIHelpers.setButtonLoading(btn, true, '<span class="spinner on-dark"></span> Guardando...');
   *   // ...
   *   UIHelpers.setButtonLoading(btn, false);
   */
  function setButtonLoading(btn, isLoading, loadingHTML) {
    if (!btn) return;

    if (isLoading) {
      if (btn.dataset.originalHtml === undefined) {
        btn.dataset.originalHtml = btn.innerHTML;
      }
      btn.disabled = true;
      btn.innerHTML = loadingHTML || '<span class="spinner on-dark"></span>';
    } else {
      btn.disabled = false;
      if (btn.dataset.originalHtml !== undefined) {
        btn.innerHTML = btn.dataset.originalHtml;
        delete btn.dataset.originalHtml;
      }
    }
  }

  /**
   * Atenúa un campo de formulario y muestra su spinner asociado
   * (un <span class="spinner field-spinner"> dentro del mismo wrapper)
   * mientras se ejecuta `callback`. Pensado para ediciones inline,
   * como el presupuesto de una categoría.
   */
  function withFieldLoading(inputEl, ms, callback) {
    const wrapper = inputEl.closest('.budget-field') || inputEl.parentElement;
    wrapper.classList.add('loading');
    inputEl.disabled = true;

    setTimeout(() => {
      callback();
      wrapper.classList.remove('loading');
      inputEl.disabled = false;
    }, ms);
  }

  // ---- API pública del módulo ----
  return {
    withOverlay,
    setButtonLoading,
    withFieldLoading,
  };

})();
