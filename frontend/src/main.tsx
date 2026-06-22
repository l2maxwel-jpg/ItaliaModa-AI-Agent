import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {AuthShell} from './auth/AuthShell';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthShell />
  </StrictMode>,
);
