// Copy this file to glance.config.js (which git ignores) and fill in your own values.
// Firebase console > Project settings > Your apps > Web app > SDK setup and configuration.
export default {
  firebase: {
    apiKey: 'YOUR_WEB_API_KEY',
    authDomain: 'your-project.firebaseapp.com',
    projectId: 'your-project',
    storageBucket: 'your-project.firebasestorage.app',
    messagingSenderId: '000000000000',
    appId: '1:000000000000:web:0000000000000000',
  },
  // Hosted web demo: reCAPTCHA Enterprise site key registered in App Check.
  recaptchaEnterpriseSiteKey: '',
  // Extension and local dev: an App Check debug token from
  // Firebase console > App Check > Apps > Manage debug tokens.
  // Set it to `true` once to print a new token in the console, then register that token.
  appCheckDebugToken: '',
};
