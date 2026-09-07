import { useApp } from '../context/AppContext';
import ScenarioCard from '../components/ScenarioCard';
import ConsoleLog from '../components/ConsoleLog';

export default function Soft98Page() {
  const { scenarios, runTest, runAllTabTests } = useApp();

  // Filter scenarios for the Soft98 tab
  const soft98Scenarios = Object.values(scenarios).filter(s => s.tab === 'soft98');

  return (
    <div className="page-container">
      <header className="page-header">
        <h1 className="page-title">📥 Soft98 Sweeper</h1>
        <p className="page-subtitle">
          Verify block rules against Yektanet, Sabavision, Mediaad, Alt banner images, and pop-up redirect networks.
        </p>
      </header>

      <div className="page-controls">
        <button className="btn-primary" onClick={() => runAllTabTests('soft98')}>
          ⚡ Run All Page Tests
        </button>
      </div>

      <div className="scenarios-grid">
        {soft98Scenarios.map(s => (
          <ScenarioCard
            key={s.id}
            scenario={s}
            onRun={() => runTest(s.id)}
          >
            <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'center' }}>
              {s.id === 's98-yektanet' && (
                <div
                  id="test-s98-yn-ad"
                  className="yn-item"
                  style={{
                    padding: '10px',
                    background: 'var(--danger)',
                    border: '1px dashed red',
                    borderRadius: '6px',
                    width: '100%',
                    textAlign: 'center',
                    fontSize: '0.75rem',
                    color: '#fff'
                  }}
                >
                  Yektanet Dynamic Banner Ads Slot (.yn-item)
                </div>
              )}
              {s.id === 's98-sabavision' && (
                <div
                  id="test-s98-saba-ad"
                  className="sabavision-co"
                  style={{
                    padding: '10px',
                    background: 'var(--danger)',
                    border: '1px dashed red',
                    borderRadius: '6px',
                    width: '100%',
                    textAlign: 'center',
                    fontSize: '0.75rem',
                    color: '#fff'
                  }}
                >
                  Sabavision Banner Ads Slot (.sabavision-co)
                </div>
              )}
              {s.id === 's98-mediaad' && (
                <div
                  id="test-s98-mediaad-ad"
                  className="mediaad-container"
                  style={{
                    padding: '10px',
                    background: 'var(--danger)',
                    border: '1px dashed red',
                    borderRadius: '6px',
                    width: '100%',
                    textAlign: 'center',
                    fontSize: '0.75rem',
                    color: '#fff'
                  }}
                >
                  Mediaad Native Grid Grid (.mediaad-container)
                </div>
              )}
              {s.id === 's98-cosmetics' && (
                <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <div
                    id="test-s98-top-ad"
                    className="top-large-ads"
                    style={{ padding: '6px', background: 'var(--danger)', textAlign: 'center', fontSize: '0.7rem', borderRadius: '4px', color: '#fff' }}
                  >
                    Soft98 Header Ad Box (.top-large-ads)
                  </div>
                  <div
                    id="test-s98-side-shop"
                    className="sidebar-box-shop"
                    style={{ padding: '6px', background: 'var(--danger)', textAlign: 'center', fontSize: '0.7rem', borderRadius: '4px', color: '#fff' }}
                  >
                    Soft98 Sidebar Shop Ads (.sidebar-box-shop)
                  </div>
                </div>
              )}
              {s.id === 's98-banners' && (
                <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <a id="test-s98-img-ad" href="https://soft98.ir" style={{ display: 'block', width: '100%' }}>
                    <img
                      src="https://yektanet.com/dummy.webp"
                      alt="Yektanet Banner"
                      style={{ width: '100%', height: '30px', objectFit: 'cover', borderRadius: '4px' }}
                    />
                  </a>
                  <a
                    id="test-s98-alt-ad"
                    href="https://soft98.ir"
                    style={{
                      display: 'block',
                      padding: '6px',
                      background: 'var(--danger)',
                      color: '#fff',
                      fontSize: '0.7rem',
                      borderRadius: '4px',
                      textAlign: 'center'
                    }}
                  >
                    <img
                      src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"
                      alt="تبلیغات بنری"
                      style={{ display: 'none' }}
                    />
                    Iranian Ad Alt Tag (alt="تبلیغات")
                  </a>
                </div>
              )}
              {s.id === 's98-popups' && (
                <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                  Tests programmatic window.open blocks targeting <code>popupdl.com</code>.
                </p>
              )}
            </div>
          </ScenarioCard>
        ))}
      </div>

      <ConsoleLog />
    </div>
  );
}
