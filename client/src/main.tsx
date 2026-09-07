import { createRoot } from 'react-dom/client';
import { App } from './app.tsx';

const host = document.getElementById('root');
if (host) createRoot(host).render(<App />);
