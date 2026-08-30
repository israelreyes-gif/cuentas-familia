/**
 * js/push.js
 * -----------------------------------------------------------------------
 * Gestiona la activación/desactivación de notificaciones push.
 * PRUEBA TEMPORAL: apuntando a la nueva API en Vercel.
 * -----------------------------------------------------------------------
 */

const Push = (function () {

  const VAPID_PUBLIC_KEY = 'BImfwk2vgsDeU6EWmQVYAGFX-_7J3AiQoVYc31xWYtSSX5OzwX41WL9qNqE_ZGiRNk3UoNv0FviPDncKmGiWtaQ';
  const API_BASE = 'https://cuentas-familia-two.vercel.app';

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

  async function activar(btn) {
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
    } catch (err) {
      alert(err.message || 'No se pudieron activar las notificaciones.');
    }
  }

  async function desactivar() {
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (!sub) return;

      const endpoint = sub.endpoint;
      await sub.unsubscribe();

      const token = Auth.getToken();
      await fetch(API_BASE + '/api/push/unsubscribe', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + token,
        },
        body: JSON.stringify({ endpoint }),
      });
    } catch (err) {
      alert(err.message || 'No se pudieron desactivar las notificaciones.');
    }
  }

  async function enable(btn) {
    const estadoActual = await getStatus();

    if (estadoActual === 'unsupported') {
      alert('Las notificaciones no están disponibles aquí. En iPhone, la app tiene que estar instalada desde "Compartir → Añadir a pantalla de inicio" (no vale desde una pestaña normal de Safari).');
      return;
    }
    if (estadoActual === 'denied') {
      alert('Bloqueaste las notificaciones para esta app. Actívalas desde los Ajustes de iPhone → Notificaciones → Cuentas de casa, y vuelve a abrir la app.');
      return;
    }

    if (btn) btn.style.opacity = '.5';

    if (estadoActual === 'enabled') {
      await desactivar();
    } else {
      await activar(btn);
    }

    await renderStatus();
    if (btn) btn.style.opacity = '';
  }

  async function renderStatus() {
    const bell = document.getElementById('pushBell');
    if (!bell) return;

    const status = await getStatus();

    if (status === 'unsupported') {
      bell.classList.add('hidden');
      return;
    }

    bell.classList.remove('hidden');
    bell.classList.toggle('enabled', status === 'enabled');
    bell.setAttribute('aria-label', status === 'enabled' ? 'Avisos activados. Toca para desactivar.' : 'Activar avisos');
  }

  return { enable, renderStatus, isSupported };

})();
