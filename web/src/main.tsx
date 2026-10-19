// The entry point of the web application. It connects React to the page and makes the shared services.
// `index.html` loads this file. Vite compiles the TypeScript and the JSX for the browser.

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

// The web imports name the `.tsx` file directly, because Vite resolves the files (not Node.js).
import App from './App.tsx';
// An import of a CSS file tells Vite to add the styles to the page.
import './index.css';

// TanStack Query keeps the server data, and it controls the loading and error states.
const queryClient = new QueryClient();

// `index.html` contains this element. If it is absent, stop with a clear message.
const root = document.getElementById('root');
if (root === null) {
  throw new Error('The page has no element with the ID "root".');
}

// `createRoot` connects React to the element. `render` shows the component tree in it.
createRoot(root).render(
  // StrictMode finds some errors in components during development. It has no effect in the production build.
  <StrictMode>
    {/*
      A provider makes a value available to all components inside it, without a property on each component.
      Here, each component that calls `useQuery` gets this query client.
    */}
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
