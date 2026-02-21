import 'dotenv/config';
import { notifyOwner } from './server/_core/notification.ts';

// Test payload
const testPayload = {
  title: "Booking Created - Test Resident",
  content: "Service: Laundry | Resident: Test | Unit: 101 | Scheduled: Friday 7-10 AM | Action: booking_created"
};

console.log('Starting notifyOwner test...');
console.log('Test payload:', JSON.stringify(testPayload, null, 2));
console.log('');

try {
  const result = await notifyOwner(testPayload);
  console.log('');
  console.log('Test completed. Result:', result);
} catch (error) {
  console.error('Test failed with error:', error);
}
