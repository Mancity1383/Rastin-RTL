import { useApp } from '../context/AppContext';
import ScenarioCard from '../components/ScenarioCard';
import ConsoleLog from '../components/ConsoleLog';

export default function NetworkPage() {
  const { scenarios, runTest, runAllTabTests, mountVideoMock } = useApp();

  // Filter scenarios for the Network tab
  const networkScenarios = Object.values(scenarios).filter(s => s.tab === 'network');

  return (
    <div className="page-container">
      <header className="page-header">
        <h1 className="page-title">📡 Network, Privacy & Stealth</h1>
        <p className="page-subtitle">
          Verify network blocking rules, tracking parameter strip out, redirect cleaner layers, and stealth analytics/ad APIs mocks.
        </p>
      </header>

      <div className="page-controls">
        <button className="btn-primary" onClick={() => runAllTabTests('network')}>
          ⚡ Run All Page Tests
        </button>
      </div>

      <div className="scenarios-grid">
        {networkScenarios.map(s => (
          <ScenarioCard
            key={s.id}
            scenario={s}
            onRun={() => runTest(s.id)}
          >
            {s.id === 'net-interception' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                <span>DoubleClick: <code>doubleclick.net</code></span>
                <span>Analytics: <code>google-analytics.com</code></span>
              </div>
            )}
            {s.id === 'net-tracking-params' && (
              <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                Verifies automatic URL scrubbing of parameters like <code>utm_source</code>, <code>fbclid</code>, etc.
              </p>
            )}
            {s.id === 'net-crypto-miner' && (
              <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                WebSocket block test to: <code>wss://coinhive.com/miner</code>
              </p>
            )}
            {s.id === 'net-video-skip' && (
              <div
                id="test-ab-video-ad-container"
                className="video-ads"
                style={{
                  position: 'relative',
                  width: '100%',
                  height: '100px',
                  background: '#000',
                  borderRadius: '6px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
              >
                <video
                  id="test-ab-video-el"
                  style={{ width: '100%', height: '100%' }}
                  ref={mountVideoMock}
                  muted
                  playsInline
                >
                  <source src="data:video/mp4;base64,AAAAIGZ0eXBtcDQyAAAAAG1wNDJpc29tYXZjMQAA" type="video/mp4" />
                </video>
                <button
                  className="ytp-ad-skip-button"
                  style={{
                    position: 'absolute',
                    bottom: '10px',
                    right: '10px',
                    padding: '4px 8px',
                    background: 'var(--bg-tertiary)',
                    border: '1px solid var(--border)',
                    borderRadius: '4px',
                    fontSize: '0.75rem'
                  }}
                >
                  Skip Ad
                </button>
              </div>
            )}
            {s.id === 'net-notifications' && (
              <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                Requests notification permission from browser context.
              </p>
            )}
            {s.id === 'net-redirect' && (
              <div style={{ textAlign: 'center' }}>
                <a
                  id="test-net-redirect-el"
                  href="https://example.com/redirect?u=https%3A%2F%2Fgoogle.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: 'var(--accent-light)' }}
                >
                  https://example.com/redirect?u=https%3A%2F%2Fgoogle.com
                </a>
              </div>
            )}
            {s.id === 'net-api-spoof' && (
              <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                Verifies mock API existence of <code>adsbygoogle</code>, <code>googletag</code>, and <code>ga</code>.
              </p>
            )}
            {s.id === 'net-fuckadblock' && (
              <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                Verifies mock class definitions of <code>FuckAdBlock</code> and <code>BlockAdBlock</code>.
              </p>
            )}
          </ScenarioCard>
        ))}
      </div>

      <ConsoleLog />
    </div>
  );
}
