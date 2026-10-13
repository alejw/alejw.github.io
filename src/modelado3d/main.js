import App from './app/App.js';

const container = document.querySelector('#scene-container');

if (!container) {
  throw new Error('No se encontró el contenedor #scene-container en el DOM.');
}

const app = new App(container);

window.addEventListener('beforeunload', () => app.dispose());
