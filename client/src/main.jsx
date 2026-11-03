import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import './i18n/index.js';
import App from './app/App.jsx';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
