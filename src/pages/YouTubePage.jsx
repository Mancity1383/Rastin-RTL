import { useApp } from '../context/AppContext';
import ScenarioCard from '../components/ScenarioCard';
import ConsoleLog from '../components/ConsoleLog';

export default function YouTubePage() {
  const { scenarios, runTest, runAllTabTests, mountVideoMock, setSkipClicked } = useApp();

  // Filter scenarios for the YouTube tab
  const ytScenarios = Object.values(scenarios).filter(s => s.tab === 'youtube');

  return (
    <div className="page-container">
      <header className="page-header">
        <h1 className="page-title">📺 YouTube Watchdog</h1>
        <p className="page-subtitle">
          Verify video ad acceleration, auto-click skip buttons, anti-adblock message removals, and video pause overrides.
        </p>
      </header>

      <div className="page-controls">
        <button className="btn-primary" onClick={() => runAllTabTests('youtube')}>
          ⚡ Run All Page Tests
        </button>
      </div>

      <div className="scenarios-grid">
        {ytScenarios.map(s => (
          <ScenarioCard
            key={s.id}
            scenario={s}
            onRun={() => runTest(s.id)}
          >
            <div
              id="movie_player"
              style={{
                position: 'relative',
                width: '100%',
                minHeight: '100px',
                background: '#111',
                border: '1px solid #333',
                borderRadius: '8px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                overflow: 'hidden'
              }}
            >
              {s.id === 'yt-speedup' && (
                <video
                  id="test-yt-video"
                  style={{ width: '100%', height: '100%' }}
                  ref={mountVideoMock}
                  muted
                  playsInline
                >
                  <source src="data:video/mp4;base64,AAAAIGZ0eXBtcDQyAAAAAG1wNDJpc29tYXZjMQAA" type="video/mp4" />
                </video>
              )}
              {s.id === 'yt-autoskip' && (
                <div style={{ width: '100%', height: '100%', display: 'flex', justifyContent: 'flex-end', alignItems: 'flex-end', padding: '12px' }}>
                  <button
                    className="ytp-ad-skip-button"
                    onClick={() => setSkipClicked(true)}
                    style={{
                      padding: '6px 12px',
                      background: '#333',
                      border: '1px solid #555',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      fontSize: '0.75rem',
                      fontWeight: 'bold',
                      color: '#fff'
                    }}
                  >
                    Skip Ad
                  </button>
                </div>
              )}
              {s.id === 'yt-cosmetics' && (
                <div style={{ width: '100%', padding: '10px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <div id="masthead-ad" style={{ padding: '8px', background: 'var(--danger)', borderRadius: '4px', fontSize: '0.75rem', textAlign: 'center', color: '#fff' }}>
                    Masthead Ad Banner
                  </div>
                  <ytd-ad-slot-renderer id="test-yt-ad-slot" style={{ padding: '8px', background: 'var(--danger)', borderRadius: '4px', fontSize: '0.75rem', textAlign: 'center', color: '#fff' }}>
                    In-feed Ad Slot
                  </ytd-ad-slot-renderer>
                  <div id="test-yt-sidebar-ad" style={{ padding: '8px', background: 'var(--danger)', borderRadius: '4px', fontSize: '0.75rem', textAlign: 'center', color: '#fff' }} className="ytd-companion-slot-renderer">
                    Sidebar Companion Ad
                  </div>
                </div>
              )}
              {s.id === 'yt-enforcement' && (
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                  Enforcement dialog intercept verification sandbox.
                </div>
              )}
              {s.id === 'yt-pause-shield' && (
                <video
                  id="test-yt-video-pause"
                  style={{ width: '100%', height: '100%' }}
                  ref={mountVideoMock}
                  muted
                  playsInline
                >
                  <source src="data:video/mp4;base64,AAAAIGZ0eXBtcDQyAAAAAG1wNDJpc29tYXZjMQAA" type="video/mp4" />
                </video>
              )}
              {s.id === 'yt-continue-watching' && (
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                  "Video paused. Continue watching?" auto-click watchdog sandbox.
                </div>
              )}
            </div>
          </ScenarioCard>
        ))}
      </div>

      <ConsoleLog />
    </div>
  );
}
