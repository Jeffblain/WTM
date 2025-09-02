// build-config.js - Place in ROOT directory
const BUILD_CONFIGS = {
    development: {
        defaultRefreshMode: 'manual',
        showRefreshControls: true,
        autoRefreshInterval: 10, 
        operatingHours: { enabled: false, start: '09:00', end: '18:00' },
        serverSaving: true,
        apiBase: 'http://localhost:3001'
    },

    staging: {
        defaultRefreshMode: 'auto',
        showRefreshControls: true,
        autoRefreshInterval: 30,
        operatingHours: { enabled: true, start: '09:00', end: '18:00' },
        serverSaving: true,
        apiBase: 'https://wtm-production.up.railway.app'
    },

    production: {
        defaultRefreshMode: 'scheduled',
        showRefreshControls: false,
        autoRefreshInterval: 60,
        operatingHours: { enabled: true, start: '09:00', end: '18:00' },
        serverSaving: false,
        apiBase: 'https://wtm-production.up.railway.app'
    }
};

function getEnvironment() {
    const hostname = window.location.hostname;
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
        return 'development';
    } else if (hostname.includes('railway') || hostname.includes('staging')) {
        return 'staging';
    } else {
        return 'production';
    }
}

// Export configuration
const CONFIG = BUILD_CONFIGS[getEnvironment()];
console.log('🔧 Environment:', getEnvironment(), 'Config:', CONFIG);