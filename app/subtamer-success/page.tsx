export default function SubTamerSuccess() {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#1a1a1a', color: '#fff', fontFamily: 'sans-serif', textAlign: 'center', padding: '2rem' }}>
      <div>
        <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>🎉</div>
        <h1 style={{ fontSize: '2rem', marginBottom: '0.5rem', color: '#ffd700' }}>Welcome to SubTamer Premium!</h1>
        <p style={{ fontSize: '1.1rem', color: '#ccc', marginBottom: '1rem' }}>
          Your license key is on its way to your email.<br />
          Paste it into the SubTamer extension to activate.
        </p>
        <p style={{ fontSize: '0.9rem', color: '#888' }}>You can close this tab.</p>
        <p style={{ fontSize: '0.85rem', color: '#666', marginTop: '1.5rem' }}>
          Need to manage or cancel later? Visit <a href="/subtamer-manage" style={{ color: '#ffd700' }}>Manage Subscription</a>.
        </p>
      </div>
    </div>
  );
}
