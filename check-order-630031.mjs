import 'dotenv/config';
import mysql from 'mysql2/promise';

const conn = await mysql.createConnection(process.env.DATABASE_URL);

// Check the specific order
const [order] = await conn.execute(`
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
  WHERE id = 630031
`);

console.log('Order #630031:');
if (order.length > 0) {
  const o = order[0];
  console.log(`  Name: ${o.firstName} ${o.lastName}`);
  console.log(`  Phone: ${o.phone}`);
  console.log(`  Pickup: ${o.pickupDate}`);
  console.log(`  Stripe Customer ID: ${o.stripeCustomerId || 'NULL'}`);
  console.log(`  Stripe Payment Method ID: ${o.stripePaymentMethodId || 'NULL'}`);
  console.log(`  Created: ${o.createdAt}`);
} else {
  console.log('  NOT FOUND');
}

// Also check all orders with this phone
console.log('\nAll orders with phone (999) 999-9999:');
const [allOrders] = await conn.execute(`
  SELECT 
    id, 
    firstName, 
    lastName, 
    stripeCustomerId,
    stripePaymentMethodId,
    createdAt
  FROM orders 
  WHERE phone LIKE '%999%999%9999%'
  ORDER BY id DESC
  LIMIT 10
`);

for (const o of allOrders) {
  console.log(`  Order #${o.id} | ${o.firstName} ${o.lastName} | Cust: ${o.stripeCustomerId || 'NULL'} | PM: ${o.stripePaymentMethodId || 'NULL'}`);
}

await conn.end();
