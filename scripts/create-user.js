// Create a riOs account and print its API key: npm run create-user -- "Your name"
import { getApp } from '../src/app.js';

const name = process.argv.slice(2).join(' ') || 'riOs user';
const { user, apiKey } = await getApp().vault.createUser(name);
console.log(`Created ${user.name} (${user.id})\nAPI key (shown once): ${apiKey}`);
