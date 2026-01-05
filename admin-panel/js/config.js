// Dynamic API Configuration
// Sets API_BASE based on the current domain

const getAPIBase = () => {
  const protocol = window.location.protocol;
  const hostname = window.location.hostname;
  const port = window.location.port;
  let baseURL = `${protocol}//${hostname}`;
  if (port) baseURL += `:${port}`;
  return baseURL;
};

// API Configuration
window.API_BASE = getAPIBase();

// Export configuration
const config = {
  API_BASE: window.API_BASE,
  
  // API Endpoints
  endpoints: {
    auth: `${window.API_BASE}/api/auth`,
    users: `${window.API_BASE}/api/users`,
    vault: `${window.API_BASE}/api/vault`,
    documents: `${window.API_BASE}/api/documents`,
    settings: `${window.API_BASE}/api/settings`,
    // Add more endpoints as needed
  },
  
  // Request timeout (in milliseconds)
  requestTimeout: 30000,
  
  // Enable debug logging
  debug: true
};

// Log configuration in debug mode
if (config.debug) {
  console.log('API Configuration loaded:', {
    API_BASE: config.API_BASE,
    protocol: window.location.protocol,
    hostname: window.location.hostname,
    port: window.location.port || 'default'
  });
}
