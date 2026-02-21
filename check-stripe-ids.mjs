import 'dotenv/config';
import mysql from 'mysql2/promise';

const conn = await mysql.createConnection(process.env.DATABASE_URL);
const [rows] = await conn.execute(`
  SELECT 
    id, 
    firstName, 
    lastName, 
    phone,
    stripeCustomerId,
    stripePaymentMethodId,
    stripePaymentIntentId,
    createdAt
  FROM orders 
  WHERE stripeCustomerId IS NOT NULL OR stripePaymentMethodId IS NOT NULL
  ORDER BY id DESC 
  LIMIT 10
`);

console.log('Orders with Stripe IDs:');
console.log(`Total: ${rows.length}\n`);
for (const r of rows) {
  console.log(`Order #${r.id} | ${r.firstName} ${r.lastName} | ${r.phone}`);
  console.log(`  Customer ID: ${r.stripeCustomerId}`);
  console.log(`  Payment Method ID: ${r.stripePaymentMethodId}`);
  console.log(`  Payment Intent ID: ${r.stripePaymentIntentId}`);
  console.log(`  Created: ${r.createdAt}\n`);
}
await conn.end();
