// Run due renewals once: npm run renew
import { getApp } from '../src/app.js';

console.log(JSON.stringify(await getApp().vault.runRenewals(), null, 2));
