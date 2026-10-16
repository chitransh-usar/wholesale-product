const test = require('node:test');
const assert = require('node:assert/strict');
const { mapPaymentStatusToOrderStatus, validateStatusTransition } = require('../src/services/orderStatusService');

test('maps payment success to the enterprise order lifecycle', () => {
  assert.equal(mapPaymentStatusToOrderStatus('paid'), 'payment_completed');
  assert.equal(mapPaymentStatusToOrderStatus('pending'), 'payment_pending');
  assert.equal(mapPaymentStatusToOrderStatus('failed'), 'payment_failed');
});

test('allows payment pending to payment completed transition', () => {
  const result = validateStatusTransition('payment_pending', 'payment_completed');
  assert.equal(result.valid, true);
});

test('rejects invalid transitions for the enterprise lifecycle', () => {
  const result = validateStatusTransition('payment_pending', 'supplier_accepted');
  assert.equal(result.valid, false);
  assert.match(result.message, /Cannot transition/);
});
