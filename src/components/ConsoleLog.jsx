import { useEffect, useRef, memo } from 'react';
import { useApp } from '../context/AppContext';

const ConsoleLog = memo(() => {
  const { logs, setLogs } = useApp();
  const consoleEndRef = useRef(null);

  useEffect(() => {
    if (consoleEndRef.current) {
      consoleEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs]);

  return (
    <div className="console-container">
      <div className="console-header">
        <div className="console-title">
          <span className="console-pulse"></span>
          <span>TEST RUNNER CONSOLE LOGS</span>
        </div>
        <button
          className="btn-secondary"
          style={{ padding: '4px 10px', fontSize: '0.75rem' }}
          onClick={() => setLogs([])}
        >
          🗑️ Clear
        </button>
      </div>
      <div className="console-logs">
        {logs.map((log, index) => (
          <div className={`log-entry ${log.type}`} key={index}>
            <span className="log-time">[{log.time}]</span>
            <span>{log.text}</span>
          </div>
        ))}
        <div ref={consoleEndRef} />
      </div>
    </div>
  );
});

ConsoleLog.displayName = 'ConsoleLog';

export default ConsoleLog;
