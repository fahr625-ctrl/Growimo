import { initDb } from './src/db/init';
await initDb();
import { getDb } from './src/db/index';
import { qInsertTrackingEvent, qGetTrackingReport } from './src/db/queries';
import { OWNER_USER_ID, TEST_USER_IDS } from './src/lib/tracking';
const sql = getDb();
const T = 'test_beta_tracking_user';
const O = OWNER_USER_ID;
// Clean slate for our test ids
await sql`DELETE FROM tracking_events WHERE user_id IN (${T}, ${O})`;
// Real-user-like sequence for test user
await qInsertTrackingEvent(T, 'user_registered', {});
await qInsertTrackingEvent(T, 'user_login', {});
await qInsertTrackingEvent(T, 'project_created', {});
await qInsertTrackingEvent(T, 'image_studio_opened', {});
await qInsertTrackingEvent(T, 'image_generated', { aspectRatio: '2:3' });
await qInsertTrackingEvent(T, 'pinterest_pin_created', { channel: 'pinterest_pin' });
await qInsertTrackingEvent(T, 'upgrade_clicked', { source: 'pricing' });
await qInsertTrackingEvent(T, 'package_or_pricing_opened', { page: 'pricing' });
// Another real user (partial funnel: registered + project only)
await qInsertTrackingEvent('test_beta_user2', 'user_registered', {});
await qInsertTrackingEvent('test_beta_user2', 'project_created', {});
// Owner test activity (should be EXCLUDED when hideOwn=true)
await qInsertTrackingEvent(O, 'user_registered', {});
await qInsertTrackingEvent(O, 'image_generated', { aspectRatio: '1:1' });

// Report WITHOUT excluding (all 3 users, owner included)
const all = await qGetTrackingReport(7, []);
console.log('\n=== REPORT rangeDays=7, no exclusion ===');
console.log('uniqueUsers:', all.uniqueUsers, '(expect 3)');
console.log('newRegistrations:', all.newRegistrations, '(expect 3)');
console.log('activeUsers:', all.activeUsers, '(expect 3)');
console.log('eventsByType:', JSON.stringify(all.eventsByType));
console.log('funnel:', JSON.stringify(all.funnel));
console.log('lastActivity rows:', all.lastActivity.length);

// Report WITH exclusion (owner+test hidden) — default dashboard view
const excl = await qGetTrackingReport(7, TEST_USER_IDS);
console.log('\n=== REPORT rangeDays=7, TEST_USER_IDS excluded (default) ===');
console.log('uniqueUsers:', excl.uniqueUsers, '(expect 2)');
console.log('newRegistrations:', excl.newRegistrations, '(expect 2)');
console.log('activeUsers:', excl.activeUsers, '(expect 2)');
console.log('funnel:', JSON.stringify(excl.funnel));
console.log('excludedUserIds:', JSON.stringify(excl.excludedUserIds));

const n = await sql`SELECT COUNT(*) AS n FROM tracking_events WHERE user_id=${T}`;
console.log('\nTotal events for test user:', n[0].n, '(expect 8)');
// Cleanup test data (leave DB clean as required)
await sql`DELETE FROM tracking_events WHERE user_id IN (${T}, 'test_beta_user2') AND user_id <> ${O}`;
console.log('Cleaned test rows. Remaining owner rows:', (await sql`SELECT COUNT(*) AS n FROM tracking_events WHERE user_id=${O}`)[0].n);
