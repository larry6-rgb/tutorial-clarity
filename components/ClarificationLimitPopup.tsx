import React from 'react';

interface ClarificationLimitPopupProps {
  type: 'warning' | 'limit';
  remainingMinutes: number;
  onContinue?: () => void;
  onStop: () => void;
}

export default function ClarificationLimitPopup({
  type,
  remainingMinutes,
  onContinue,
  onStop
}: ClarificationLimitPopupProps) {
  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0,0,0,0.85)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 2000,
      padding: '20px'
    }}>
      <div style={{
        backgroundColor: '#2d2d44',
        borderRadius: '16px',
        padding: '40px',
        maxWidth: '600px',
        width: '100%',
        textAlign: 'center',
        color: 'white'
      }}>
        {type === 'warning' ? (
          <>
            <h2 style={{ fontSize: '32px', marginBottom: '20px', color: '#FFA726' }}>
              ⚠️ Usage Warning
            </h2>
            <p style={{ fontSize: '22px', lineHeight: '1.6', marginBottom: '30px' }}>
              You have <strong>{remainingMinutes} minutes</strong> of free clarification remaining today.
            </p>
            <p style={{ fontSize: '20px', lineHeight: '1.6', marginBottom: '30px', color: '#aaa' }}>
              This applies across all videos you watch today.
            </p>
            <div style={{ display: 'flex', gap: '20px', justifyContent: 'center', flexWrap: 'wrap' }}>
              <button
                onClick={onContinue}
                style={{
                  padding: '18px 40px',
                  fontSize: '22px',
                  backgroundColor: '#4CAF50',
                  color: 'white',
                  border: 'none',
                  borderRadius: '10px',
                  cursor: 'pointer',
                  fontWeight: 'bold'
                }}
              >
                Continue Watching
              </button>
              <button
                onClick={onStop}
                style={{
                  padding: '18px 40px',
                  fontSize: '22px',
                  backgroundColor: '#666',
                  color: 'white',
                  border: 'none',
                  borderRadius: '10px',
                  cursor: 'pointer',
                  fontWeight: 'bold'
                }}
              >
                Stop for Today
              </button>
            </div>
          </>
        ) : (
          <>
            <h2 style={{ fontSize: '32px', marginBottom: '20px', color: '#f44336' }}>
              🛑 Daily Limit Reached
            </h2>
            <p style={{ fontSize: '22px', lineHeight: '1.6', marginBottom: '20px' }}>
              You've used your <strong>30 free minutes</strong> of clarification today.
            </p>
            <p style={{ fontSize: '20px', lineHeight: '1.6', marginBottom: '30px', color: '#aaa' }}>
              <strong>Paid tier coming soon!</strong>
            </p>
            <p style={{ fontSize: '20px', lineHeight: '1.6', marginBottom: '30px', color: '#4CAF50' }}>
              💡 <strong>Tip:</strong> Use our <strong>Resume Session</strong> feature to save your progress and return tomorrow for 30 more free minutes!
            </p>
            <button
              onClick={onStop}
              style={{
                padding: '18px 40px',
                fontSize: '22px',
                backgroundColor: '#2196F3',
                color: 'white',
                border: 'none',
                borderRadius: '10px',
                cursor: 'pointer',
                fontWeight: 'bold'
              }}
            >
              Got It
            </button>
          </>
        )}
      </div>
    </div>
  );
}