import { NavLink, Outlet } from 'react-router-dom';
import { useApp } from '../context/AppContext';

export default function Layout() {
  const { 
    stats, 
    theme, 
    setTheme, 
    isAuditing, 
    auditProgress, 
    runGlobalAudit,
    injectAntiAdblockPopup,
    injectYoutubeWarning
  } = useApp();

  return (
    <div className="layout-container">
      {/* Premium Glassmorphic Sidebar */}
      <aside className="app-sidebar">
        <div className="sidebar-brand">
          <div className="brand-logo">🛡️</div>
          <div className="brand-text">
            <h2>Rastin Suite</h2>
            <span>Dev Playground</span>
          </div>
        </div>

        {/* Tab Pages Navigation */}
        <nav className="sidebar-nav">
          <NavLink to="/" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <span className="nav-icon">🌐</span>
            <span className="nav-label">RTL Fixer</span>
          </NavLink>
          <NavLink to="/adblock" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <span className="nav-icon">🛡️</span>
            <span className="nav-label">Adblocker</span>
          </NavLink>
          <NavLink to="/network" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <span className="nav-icon">📡</span>
            <span className="nav-label">Network & Privacy</span>
          </NavLink>
          <NavLink to="/youtube" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <span className="nav-icon">📺</span>
            <span className="nav-label">YouTube Watchdog</span>
          </NavLink>
          <NavLink to="/soft98" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <span className="nav-icon">📥</span>
            <span className="nav-label">Soft98 Sweeper</span>
          </NavLink>
        </nav>

        {/* Theme Customization Widget */}
        <div className="sidebar-widget">
          <div className="widget-header">THEME TUNING</div>
          <div className="theme-toggle-row">
            <button 
              className={`theme-btn cp ${theme === 'cyberpunk' ? 'active' : ''}`}
              onClick={() => setTheme('cyberpunk')}
              title="Cyberpunk Neon"
            >
              🌌
            </button>
            <button 
              className={`theme-btn em ${theme === 'emerald' ? 'active' : ''}`}
              onClick={() => setTheme('emerald')}
              title="Midnight Emerald"
            >
              🌲
            </button>
            <button 
              className={`theme-btn vb ${theme === 'volcanic' ? 'active' : ''}`}
              onClick={() => setTheme('volcanic')}
              title="Volcanic Ember"
            >
              🌋
            </button>
          </div>
        </div>

        {/* Interactive Simulation Sandbox Panel */}
        <div className="sidebar-widget">
          <div className="widget-header">SANDBOX INJECTORS</div>
          <div className="sandbox-actions">
            <button className="btn-sandbox" onClick={injectAntiAdblockPopup}>
              🚨 Inject Popup
            </button>
            <button className="btn-sandbox" onClick={injectYoutubeWarning}>
              📺 Inject Warning
            </button>
          </div>
        </div>

        {/* Global Auditor Progress Widget */}
        <div className="sidebar-widget auditor-widget">
          <div className="widget-header">SYSTEM AUDITOR</div>
          <button 
            className={`btn-audit ${isAuditing ? 'running' : ''}`} 
            onClick={runGlobalAudit}
            disabled={isAuditing}
          >
            {isAuditing ? '⚡ Auditing Suite...' : '🚀 Execute Full Audit'}
          </button>
          
          {isAuditing && (
            <div className="audit-progress-container">
              <div className="audit-progress-bar" style={{ width: `${auditProgress}%` }}></div>
              <span className="audit-percentage">{auditProgress}% Completed</span>
            </div>
          )}
        </div>

        {/* Global Statistics Panel */}
        <div className="sidebar-stats">
          <div className="stats-header">TEST RUN SUMMARY</div>
          <div className="stats-grid">
            <div className="stat-row">
              <span className="stat-dot passed"></span>
              <span className="label">Passed</span>
              <span className="value">{stats.passed}</span>
            </div>
            <div className="stat-row">
              <span className="stat-dot failed"></span>
              <span className="label">Failed</span>
              <span className="value">{stats.failed}</span>
            </div>
            <div className="stat-row">
              <span className="stat-dot warning"></span>
              <span className="label">Warning</span>
              <span className="value">{stats.warning}</span>
            </div>
            <div className="stat-row">
              <span className="stat-dot waiting"></span>
              <span className="label">Waiting</span>
              <span className="value">{stats.waiting}</span>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="main-content">
        <Outlet />
      </main>
    </div>
  );
}
