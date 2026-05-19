import { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { Link } from 'react-router-dom';

const COOKIE_CONSENT_KEY = 'nous_cookie_consent';

type ConsentType = 'all' | 'essential' | null;

interface CookieConsent {
  consent: ConsentType;
  timestamp: string;
}

export function CookieConsentBanner() {
  const [showBanner, setShowBanner] = useState(false);
  const [showDetails, setShowDetails] = useState(false);

  useEffect(() => {
    // Check if user has already given consent
    const storedConsent = localStorage.getItem(COOKIE_CONSENT_KEY);
    if (!storedConsent) {
      // Small delay to avoid flash on page load
      const timer = setTimeout(() => setShowBanner(true), 500);
      return () => clearTimeout(timer);
    }
  }, []);

  const handleAcceptAll = () => {
    const consent: CookieConsent = {
      consent: 'all',
      timestamp: new Date().toISOString(),
    };
    localStorage.setItem(COOKIE_CONSENT_KEY, JSON.stringify(consent));
    setShowBanner(false);

    // Enable analytics tracking
    enableAnalytics();
  };

  const handleAcceptEssential = () => {
    const consent: CookieConsent = {
      consent: 'essential',
      timestamp: new Date().toISOString(),
    };
    localStorage.setItem(COOKIE_CONSENT_KEY, JSON.stringify(consent));
    setShowBanner(false);

    // Disable non-essential tracking
    disableAnalytics();
  };

  const enableAnalytics = () => {
    // PostHog - enable tracking
    if (window.posthog) {
      window.posthog.opt_in_capturing();
    }

    // Google Analytics - enable (if used)
    if (window.gtag) {
      window.gtag('consent', 'update', {
        analytics_storage: 'granted',
      });
    }
  };

  const disableAnalytics = () => {
    // PostHog - disable tracking
    if (window.posthog) {
      window.posthog.opt_out_capturing();
    }

    // Google Analytics - disable (if used)
    if (window.gtag) {
      window.gtag('consent', 'update', {
        analytics_storage: 'denied',
      });
    }
  };

  if (!showBanner) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 p-4 md:p-6">
      <div
        className="max-w-2xl mx-auto rounded-xl overflow-hidden"
        style={{
          background: 'var(--landing-bg-elevated)',
          border: '1px solid var(--landing-border-default)',
          boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
        }}
      >
        <div className="p-5 md:p-6">
          <div className="flex items-start gap-4">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium mb-1" style={{ color: 'var(--landing-text-primary)' }}>
                We use cookies
              </p>
              <p className="text-xs leading-relaxed mb-4" style={{ color: 'var(--landing-text-muted)' }}>
                To improve your experience and analyze traffic. You can accept all cookies or only essential ones.{' '}
                <Link to="/cookies" className="underline hover:opacity-80" style={{ color: 'var(--landing-text-secondary)' }}>
                  Cookie Policy
                </Link>
                {' · '}
                <Link to="/privacy" className="underline hover:opacity-80" style={{ color: 'var(--landing-text-secondary)' }}>
                  Privacy Policy
                </Link>
              </p>

              {showDetails && (
                <div
                  className="rounded-lg p-4 mb-4 text-xs space-y-2"
                  style={{ background: 'var(--landing-bg-surface)', border: '1px solid var(--landing-border-subtle)' }}
                >
                  <div>
                    <span className="font-medium" style={{ color: 'var(--landing-text-primary)' }}>Essential</span>
                    <span className="ml-2" style={{ color: 'var(--landing-text-muted)' }}>Auth, security, core functionality — always on.</span>
                  </div>
                  <div>
                    <span className="font-medium" style={{ color: 'var(--landing-text-primary)' }}>Analytics</span>
                    <span className="ml-2" style={{ color: 'var(--landing-text-muted)' }}>PostHog — helps us improve the product.</span>
                  </div>
                </div>
              )}

              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={handleAcceptAll}
                  className="px-4 py-1.5 rounded-lg text-xs font-medium transition-opacity hover:opacity-90"
                  style={{ background: 'var(--landing-accent)', color: '#09090B' }}
                >
                  Accept all
                </button>
                <button
                  onClick={handleAcceptEssential}
                  className="px-4 py-1.5 rounded-lg text-xs font-medium transition-colors"
                  style={{
                    background: 'transparent',
                    border: '1px solid var(--landing-border-default)',
                    color: 'var(--landing-text-secondary)',
                  }}
                >
                  Essential only
                </button>
                <button
                  onClick={() => setShowDetails(!showDetails)}
                  className="text-xs transition-colors hover:opacity-80"
                  style={{ color: 'var(--landing-text-muted)' }}
                >
                  {showDetails ? 'Less' : 'Details'}
                </button>
              </div>
            </div>

            <button
              onClick={handleAcceptEssential}
              className="p-1 flex-shrink-0 transition-opacity hover:opacity-70"
              style={{ color: 'var(--landing-text-muted)' }}
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Utility function to check consent status
export function getCookieConsent(): ConsentType {
  const stored = localStorage.getItem(COOKIE_CONSENT_KEY);
  if (!stored) return null;

  try {
    const consent: CookieConsent = JSON.parse(stored);
    return consent.consent;
  } catch {
    return null;
  }
}

// Utility to check if analytics is allowed
export function isAnalyticsAllowed(): boolean {
  return getCookieConsent() === 'all';
}

// Type declaration for window
declare global {
  interface Window {
    posthog?: {
      opt_in_capturing: () => void;
      opt_out_capturing: () => void;
    };
    gtag?: (command: string, action: string, params: Record<string, string>) => void;
  }
}
