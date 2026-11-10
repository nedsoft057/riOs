// Vercel serverless entry: every route is rewritten here (see vercel.json).
import { getApp } from '../src/app.js';

export default async function handler(req, res) {
  return getApp().handler(req, res);
}
