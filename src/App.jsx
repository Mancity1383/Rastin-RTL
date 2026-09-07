import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AppProvider } from './context/AppContext';
import Layout from './components/Layout';
import './App.css';

// Lazy load page routes to implement bundle code-splitting and maximum performance
const RtlPage = lazy(() => import('./pages/RtlPage'));
const AdblockPage = lazy(() => import('./pages/AdblockPage'));
const NetworkPage = lazy(() => import('./pages/NetworkPage'));
const YouTubePage = lazy(() => import('./pages/YouTubePage'));
const Soft98Page = lazy(() => import('./pages/Soft98Page'));

function App() {
  return (
    <BrowserRouter>
      <AppProvider>
        <Suspense
          fallback={
            <div className="app-loader-container">
              <div className="loader-spinner"></div>
              <span>Optimizing components...</span>
            </div>
          }
        >
          <Routes>
            <Route path="/" element={<Layout />}>
              <Route index element={<RtlPage />} />
              <Route path="adblock" element={<AdblockPage />} />
              <Route path="network" element={<NetworkPage />} />
              <Route path="youtube" element={<YouTubePage />} />
              <Route path="soft98" element={<Soft98Page />} />
            </Route>
          </Routes>
        </Suspense>
      </AppProvider>
    </BrowserRouter>
  );
}

export default App;
