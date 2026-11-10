// Small helpers: money in integer cents, calendar dates, ids, errors.
import { randomBytes, createHash } from 'node:crypto';

export class UserError extends Error {
  constructor(message, code = 'invalid_request') { super(message); this.code = code; this.user = true; }
}

export function id(prefix) { return `${prefix}_${randomBytes(9).toString('base64url')}`; }
export function sha256(s) { return createHash('sha256').update(s).digest('hex'); }

// "12.5" | 12.5 | "$12.50" -> 1250
export function toCents(v, field = 'amount') {
  if (typeof v === 'number' && Number.isFinite(v)) v = String(v);
  if (typeof v !== 'string') throw new UserError(`${field} must be a number like 9.99`);
  const s = v.trim().replace(/^\$/, '');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) throw new UserError(`${field} must be a positive amount with at most 2 decimals, like 9.99`);
  const [a, b = ''] = s.split('.');
  return Number(a) * 100 + Number((b + '00').slice(0, 2));
}

export function money(cents) {
  const neg = cents < 0; const c = Math.abs(cents);
  return `${neg ? '-' : ''}${Math.floor(c / 100)}.${String(c % 100).padStart(2, '0')}`;
}

// Dates are calendar days in UTC, written YYYY-MM-DD.
export function today(now = new Date()) { return now.toISOString().slice(0, 10); }

export function parseDate(s, field = 'date') {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new UserError(`${field} must be a date like 2026-12-01`);
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) throw new UserError(`${field} is not a real date`);
  return s;
}

// Add whole months, keeping the day where possible (Jan 31 + 1 month -> Feb 28/29).
export function addMonths(s, n) {
  const [y, m, d] = s.split('-').map(Number);
  const total = (m - 1) + n;
  const ny = y + Math.floor(total / 12);
  const nm = ((total % 12) + 12) % 12;
  const last = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  return new Date(Date.UTC(ny, nm, Math.min(d, last))).toISOString().slice(0, 10);
}

export function addDays(s, n) {
  const d = new Date(`${s}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10);
}

export function isEmail(s) { return typeof s === 'string' && s.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s); }
