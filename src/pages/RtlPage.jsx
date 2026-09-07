import { useApp } from '../context/AppContext';
import ScenarioCard from '../components/ScenarioCard';
import ConsoleLog from '../components/ConsoleLog';

export default function RtlPage() {
  const { scenarios, runTest, runAllTabTests } = useApp();

  // Filter scenarios for the RTL tab
  const rtlScenarios = Object.values(scenarios).filter(s => s.tab === 'rtl');

  const triggerPersianInput = () => {
    const input = document.getElementById('test-rtl-input-el');
    if (input) {
      input.value = 'این یک متن فارسی تایپ شده است';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      runTest('rtl-input');
    }
  };

  return (
    <div className="page-container">
      <header className="page-header">
        <h1 className="page-title">🌐 RTL Layout Fixer</h1>
        <p className="page-subtitle">
          Verify automatic bidirectionality, numerical formatting conversions, and physical-to-logical CSS flips.
        </p>
      </header>

      <div className="page-controls">
        <button className="btn-primary" onClick={() => runAllTabTests('rtl')}>
          ⚡ Run All Page Tests
        </button>
      </div>

      <div className="scenarios-grid">
        {rtlScenarios.map(s => (
          <ScenarioCard
            key={s.id}
            scenario={s}
            onRun={() => runTest(s.id)}
            actionButton={
              s.id === 'rtl-input' ? (
                <button className="btn-secondary" onClick={triggerPersianInput}>
                  ⌨️ Trigger Input
                </button>
              ) : null
            }
          >
            {s.id === 'rtl-basic' && (
              <h3 id="test-rtl-basic-el" className="rtl-test-element">
                این یک متن فارسی است
              </h3>
            )}
            {s.id === 'rtl-digits' && (
              <p id="test-rtl-digits-el" className="rtl-test-element">
                تست اعداد: 12345
              </p>
            )}
            {s.id === 'rtl-input' && (
              <input
                id="test-rtl-input-el"
                type="text"
                placeholder="اینجا بنویسید..."
                style={{
                  padding: '10px',
                  background: 'var(--bg-primary)',
                  border: '1px solid var(--border)',
                  borderRadius: '6px',
                  color: 'var(--text-primary)',
                  fontSize: '0.9rem',
                  width: '100%'
                }}
              />
            )}
            {s.id === 'rtl-list' && (
              <ul id="test-rtl-list-el" style={{ paddingLeft: '40px' }} className="rtl-test-element">
                <li className="rtl-list-element">مورد اول لیست تستی</li>
                <li className="rtl-list-element">مورد دوم لیست تستی</li>
              </ul>
            )}
            {s.id === 'rtl-isolate' && (
              <p id="test-rtl-isolate-el" className="rtl-test-element">
                متن فارسی با کلمه English وسط آن.
              </p>
            )}
            {s.id === 'rtl-arrows' && (
              <p id="test-rtl-arrows-el" className="rtl-test-element">
                {"تست فلش: مرحله اول -> مرحله دوم و ← برگشت."}
              </p>
            )}
            {s.id === 'rtl-table' && (
              <table id="test-rtl-table-el" style={{ borderCollapse: 'collapse', width: '100%' }}>
                <tbody>
                  <tr>
                    <td
                      style={{
                        paddingLeft: '15px',
                        paddingTop: '8px',
                        paddingBottom: '8px',
                        borderLeft: '3px solid rgb(239, 68, 68)',
                        background: 'var(--bg-primary)'
                      }}
                      className="rtl-test-element"
                    >
                      محتوای سلول تستی جدول
                    </td>
                  </tr>
                </tbody>
              </table>
            )}
            {s.id === 'rtl-blockquote' && (
              <blockquote
                id="test-rtl-blockquote-el"
                style={{
                  marginLeft: '25px',
                  borderLeft: '5px solid rgb(99, 102, 241)',
                  padding: '8px',
                  background: 'var(--bg-primary)'
                }}
                className="rtl-test-element"
              >
                این یک نقل قول تستی فارسی است.
              </blockquote>
            )}
          </ScenarioCard>
        ))}
      </div>

      <ConsoleLog />
    </div>
  );
}
