// Vercel serverless entry: every route is rewritten here (see vercel.json).
import { getApp } from '../src/app.js';

export default async function handler(req, res) {
  let app;
  try { app = getApp(); }
  catch (e) {
    // Missing setup (database or PayPal keys): say what's missing instead of crashing.
    res.statusCode = 503;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ error: 'riOs is not fully set up yet', detail: e.message }));
  }
  return app.handler(req, res);
}
