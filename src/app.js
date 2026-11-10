// Wires config, storage, PayPal and the vault together.
import { loadConfig } from './config.js';
import { createStore } from './store/index.js';
import { PayPal } from './paypal.js';
import { Vault } from './vault.js';
import { createHandler } from './http.js';

let cached;
export function getApp() {
  if (cached) return cached;
  const config = loadConfig();
  const store = createStore(config);
  const paypal = new PayPal(config.paypal);
  const vault = new Vault({ store, paypal, config });
  cached = { config, store, paypal, vault, handler: createHandler({ vault, config }) };
  return cached;
}
