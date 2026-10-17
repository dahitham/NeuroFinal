import { StrictMode, Component } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import { AuthProvider } from './context/AuthContext.jsx';
import './styles/fonts.css';
import './styles/tokens.css';
import './styles/pages.generated.css';
import './styles/app.css';

class ErrorBoundary extends Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(err) { console.error('UI error:', err && err.message); }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="ns ns-center-screen" role="alert" style={{ flexDirection: 'column', gap: 12 }}>
        <h1>Something went wrong</h1>
        <p className="ns-muted">Your saved settings are safe. Please reload the page.</p>
        <button className="ns-btn ns-btn-p" onClick={() => window.location.assign('/')}>Reload</button>
      </div>
    );
  }
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>
);
