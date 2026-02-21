import 'dotenv/config';
import mysql from 'mysql2/promise';

const conn = await mysql.createConnection(process.env.DATABASE_URL);
const [rows] = await conn.execute(`
  SELECT 
    id, 
    firstName, 
    lastName, 
    phone,
    pickupDate,
    stripeCustomerId,
    stripePaymentMethodId,
    createdAt
  FROM orders 
  WHERE id >= 630000
  ORDER BY id DESC 
  LIMIT 20
`);

console.log('Recent orders from bldg-chat (id >= 630000):');
console.log(`Total: ${rows.length}\n`);
for (const r of rows) {
  console.log(`Order #${r.id} | ${r.firstName} ${r.lastName} | ${r.phone} | pickup: ${r.pickupDate}`);
  console.log(`  Stripe Customer: ${r.stripeCustomerId || 'NULL'}`);
  console.log(`  Stripe Payment Method: ${r.stripePaymentMethodId || 'NULL'}\n`);
}
await conn.end();
