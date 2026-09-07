import { useApp } from '../context/AppContext';
import ScenarioCard from '../components/ScenarioCard';
import ConsoleLog from '../components/ConsoleLog';

export default function AdblockPage() {
  const { scenarios, runTest, runAllTabTests } = useApp();

  // Filter scenarios for the Adblock tab
  const adblockScenarios = Object.values(scenarios).filter(s => s.tab === 'adblock');

  return (
    <div className="page-container">
      <header className="page-header">
        <h1 className="page-title">🛡️ Cosmetic Adblocker</h1>
        <p className="page-subtitle">
          Verify hiding generic banners, target elements, pop-up overlays, and spoofing ad-detector metrics.
        </p>
      </header>

      <div className="page-controls">
        <button className="btn-primary" onClick={() => runAllTabTests('adblock')}>
          ⚡ Run All Page Tests
        </button>
      </div>

      <div className="scenarios-grid">
        {adblockScenarios.map(s => (
          <ScenarioCard
            key={s.id}
            scenario={s}
            onRun={() => runTest(s.id)}
          >
            {s.id === 'ab-cosmetic-generic' && (
              <div id="test-ab-generic-el" className="ad-banner ad-test-banner">
                Generic Banner Ads Box (.ad-banner)
              </div>
            )}
            {s.id === 'ab-cosmetic-specific' && (
              <ytd-ad-slot-renderer id="test-ab-specific-el">
                YouTube Site-Specific Ad mock (ytd-ad-slot-renderer)
              </ytd-ad-slot-renderer>
            )}
            {s.id === 'ab-popup-blocker' && (
              <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                Intercepts standard <code>window.open()</code> parameters.
              </p>
            )}
            {s.id === 'ab-anti-adblock' && (
              <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', textAlign: 'center' }}>
                Simulates overlay warning blocker elements containing phrase "disable your adblocker".
              </p>
            )}
            {s.id === 'ab-bait-spoofing' && (
              <div
                id="test-ab-bait"
                className="adbox"
                style={{
                  height: '0px',
                  width: '0px',
                  opacity: 0,
                  position: 'absolute',
                  pointerEvents: 'none',
                  overflow: 'hidden'
                }}
              >
                Bait element (height 0px, width 0px)
              </div>
            )}
            {s.id === 'ab-sticky' && (
              <div
                id="test-ab-sticky-el"
                className="sticky-ad"
                style={{
                  position: 'fixed',
                  zIndex: 150,
                  top: '200px',
                  left: '10px',
                  height: '100px',
                  width: '100px',
                  background: 'var(--danger)',
                  borderRadius: '8px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '0.75rem',
                  fontWeight: 'bold'
                }}
              >
                FLOATING AD
              </div>
            )}
            {s.id === 'ab-cookie' && (
              <div
                id="test-ab-cookie-el"
                className="cookie-banner"
                style={{
                  background: 'var(--bg-primary)',
                  padding: '10px',
                  borderRadius: '6px',
                  textAlign: 'center'
                }}
              >
                <span>We use cookies.</span>
                <button
                  className="reject-btn"
                  style={{
                    marginLeft: '10px',
                    padding: '2px 8px',
                    background: 'var(--bg-tertiary)',
                    border: '1px solid var(--border)',
                    borderRadius: '4px',
                    cursor: 'pointer'
                  }}
                >
                  Reject
                </button>
              </div>
            )}
          </ScenarioCard>
        ))}
      </div>

      <ConsoleLog />
    </div>
  );
}
