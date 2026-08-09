import { render } from 'preact';
import { App } from './ui/App';
import './styles.css';

const root = document.getElementById('app');
if (!root) throw new Error('#app fehlt im Dokument.');

render(<App />, root);

// Service Worker: macht die App offline spielbar — im Zug ohne Empfang liegen
// ROM und Spielstände längst auf dem Gerät, nur die Seite selbst fehlte sonst.
// Schlägt die Registrierung fehl (etwa über http://), läuft alles Übrige weiter.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL })
      .catch(() => {
        /* Ohne Offline-Fähigkeit ist die App weiterhin benutzbar. */
      });
  });
}
