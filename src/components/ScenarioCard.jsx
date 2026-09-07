import { memo } from 'react';

const ScenarioCard = memo(({ scenario, onRun, children, actionButton }) => {
  const { title, desc, status, expected, actual, checked } = scenario;

  return (
    <div className="scenario-card">
      <div className="scenario-header">
        <div className="scenario-info">
          <h3 className="scenario-title">{title}</h3>
          <p className="scenario-desc">{desc}</p>
        </div>
        <span className={`badge ${status}`}>{status}</span>
      </div>

      <div className="test-execution-area">
        <span className="preview-label">Live Preview</span>
        <div className="preview-wrapper-content">
          {children}
        </div>
      </div>

      {checked && (
        <div className="test-details">
          <div className="details-row">
            <span className="details-label">Expected:</span>
            <span className="details-value">{expected}</span>
          </div>
          <div className="details-row">
            <span className="details-label">Actual:</span>
            <span className={`details-value ${status}`}>{actual}</span>
          </div>
        </div>
      )}

      <div className="card-actions">
        {actionButton}
        <button className="btn-secondary" onClick={onRun}>
          ▶️ Run Test
        </button>
      </div>
    </div>
  );
});

ScenarioCard.displayName = 'ScenarioCard';

export default ScenarioCard;
