import 'dotenv/config';
import mysql from 'mysql2/promise';

const conn = await mysql.createConnection(process.env.DATABASE_URL);
const [rows] = await conn.execute('SELECT id, firstName, lastName, phone, pickupDate, status, serviceType, createdAt FROM orders ORDER BY id DESC LIMIT 20');
console.log('Total orders found:', rows.length);
for (const r of rows) {
  console.log(`  #${r.id} | ${r.firstName} ${r.lastName} | ${r.phone} | pickup: ${r.pickupDate} | status: ${r.status} | type: ${r.serviceType} | created: ${r.createdAt}`);
}
await conn.end();
