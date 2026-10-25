import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { ConfirmProvider } from './components/ConfirmDialog.jsx';
import './styles.css';

if (import.meta.env.DEV && !window.valorant) {
  const { installDevMock } = await import('./devMock.js');
  installDevMock();
}

createRoot(document.getElementById('root')).render(
  <StrictMode><ConfirmProvider><App /></ConfirmProvider></StrictMode>
);
