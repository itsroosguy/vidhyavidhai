#!/usr/bin/env node
/**
 * Builds the single-file Google Apps Script bundle (`apps-script/dist/CareerToursAllInOne.gs`)
 * from the modular `apps-script/*.gs` sources in deterministic dependency order.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');
const APPS_SCRIPT_DIR = path.join(ROOT_DIR, 'apps-script');
const DIST_DIR = path.join(APPS_SCRIPT_DIR, 'dist');
const OUT_FILE = path.join(DIST_DIR, 'CareerToursAllInOne.gs');

const MODULE_ORDER = [
  'Audit.gs',
  'Configuration.gs',
  'Auth.gs',
  'Calculations.gs',
  'Validation.gs',
  'Schools.gs',
  'SetupDatabase.gs',
  'Sessions.gs',
  'Admin.gs',
  'Export.gs',
  'Code.gs',
];

const HEADER = `/**
 * CareerToursAllInOne.gs — Complete Google Apps Script Backend
 * Vidhya Vidhai · Career Tours Classroom Data Entry & Feedback Management System
 *
 * SETUP INSTRUCTIONS (Apps Script Sync Bridge):
 * 1. Open Google Sheets -> Extensions -> Apps Script (or open https://script.google.com).
 * 2. Replace all code inside Code.gs with this entire file and click Save (Ctrl/Cmd + S).
 * 3. Select the function \`setupForLocalSandbox\` from the top toolbar and click Run (grant Google Sheet permissions once).
 *    - Your Sync Passphrase is prefilled in \`CT_PRESET_SANDBOX_SYNC_KEY\` when copied from the app,
 *      OR you may set Script Property \`SANDBOX_SYNC_KEY\` under Project Settings -> Script properties.
 * 4. Click Deploy -> New deployment -> Web app:
 *    - Execute as: Me
 *    - Who has access: Anyone
 * 5. Copy the Web app URL ending in /exec and paste it into the Career Tours top Google Sheets bar.
 */

`;

fs.mkdirSync(DIST_DIR, { recursive: true });

const sections = MODULE_ORDER.map((filename) => {
  const fullPath = path.join(APPS_SCRIPT_DIR, filename);
  const src = fs.readFileSync(fullPath, 'utf8').trim();
  return `// ============================================================================\n// Module: ${filename}\n// ============================================================================\n\n${src}`;
});

const bundle = `${HEADER}${sections.join('\n\n')}\n`;
fs.writeFileSync(OUT_FILE, bundle, 'utf8');

console.log(
  `Built ${path.relative(ROOT_DIR, OUT_FILE)} (${MODULE_ORDER.length} modules, ${bundle.length} bytes).`,
);
