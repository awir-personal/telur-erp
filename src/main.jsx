import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import { ThemeProvider } from './lib/theme';
import { ConfirmProvider } from './lib/confirm';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <ThemeProvider><ConfirmProvider><BrowserRouter><App /></BrowserRouter></ConfirmProvider></ThemeProvider>,
);
