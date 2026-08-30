/**
 * js/push.js
 * -----------------------------------------------------------------------
 * Gestiona la activación de notificaciones push en este dispositivo:
 * pide permiso, se suscribe al servicio de notificaciones del navegador
 * con la clave pública VAPID, y guarda esa suscripción en el servidor
 * para que el Worker pueda enviarle avisos más adelante.
 * -----------------------------------------------------------------------
 */

const Push = (function () {

  const VAPID_PUBLIC_KEY = 'BImfwk2vgsDeU6EWmQVYAGFX-_7J3AiQoVYc31xWYtSSX5OzwX41WL9qNqE_ZGiRNk3UoNv0FviPDncKmGiWtaQ';
  const API_BASE = 'https://cuentas-familia-api.israel-reyes.workers.dev';

  function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
    return outputArray;
  }

  function isSupported() {
    return 'serviceWorker' in navigator && 'PushManager' in window;
  }

  async function getStatus() {
    if (!isSupported()) return 'unsupported';
    if (Notification.permission === 'denied') return 'denied';
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    return sub ? 'enabled' : 'disabled';
  }

  async function enable(btn) {
    if (!isSupported()) {
      alert('Las notificaciones no están disponibles aquí. En iPhone, la app tiene que estar instalada desde "Compartir → Añadir a pantalla de inicio" (no vale desde una pestaña normal de Safari).');
      return;
    }

    if (btn) UIHelpers.setButtonLoading(btn, true, '<span class="spinner on-dark"></span>');

    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        throw new Error('No se concedió permiso para las notificaciones.');
      }

      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
        });
      }

      const token = Auth.getToken();
      const res = await fetch(API_BASE + '/api/push/subscribe', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + token,
        },
        body: JSON.stringify({ subscription: sub.toJSON() }),
      });
      if (!res.ok) throw new Error('No se pudo guardar la suscripción en el servidor.');

      await renderStatus();
    } catch (err) {
      alert(err.message || 'No se pudieron activar las notificaciones.');
    } finally {
      if (btn) UIHelpers.setButtonLoading(btn, false);
    }
  }

  /** Pinta el estado actual (activado / bloqueado / no disponible) en la pantalla de Administrar categorías. */
  async function renderStatus() {
    const el = document.getElementById('pushStatus');
    const btn = document.getElementById('pushBtn');
    if (!el || !btn) return;

    const status = await getStatus();
    if (status === 'enabled') {
      el.textContent = '✓ Avisos activados en este dispositivo.';
      btn.classList.add('hidden');
    } else if (status === 'denied') {
      el.textContent = 'Bloqueaste las notificaciones para esta app. Actívalas desde los Ajustes de iPhone → Notificaciones → Cuentas de casa.';
      btn.classList.add('hidden');
    } else if (status === 'unsupported') {
      el.textContent = 'Instala la app desde "Compartir → Añadir a pantalla de inicio" para poder activar avisos.';
      btn.classList.add('hidden');
    } else {
      el.textContent = 'Recibe un aviso el día 1 de cada mes para registrar la nómina.';
      btn.classList.remove('hidden');
    }
  }

  return { enable, renderStatus, isSupported };

})();
