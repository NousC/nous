// Auth0 configuration for frontend
// These should match your Auth0 application settings
export const auth0Config = {
  domain: import.meta.env.VITE_AUTH0_DOMAIN || 'dev-oco8uyv1n44nlave.us.auth0.com',
  clientId: import.meta.env.VITE_AUTH0_CLIENT_ID || 'VfOxfqsAJu5Khl8pvTnAvELB4t1mKl3f',
  authorizationParams: {
    redirect_uri: window.location.origin,
    audience: import.meta.env.VITE_AUTH0_AUDIENCE || 'https://api.assetly.app', // Your Auth0 API identifier
  },
};

// Backend API URL
export const API_URL = import.meta.env.VITE_API_URL ?? '';

