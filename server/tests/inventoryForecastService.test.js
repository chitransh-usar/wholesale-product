const test = require('node:test');
const assert = require('node:assert/strict');
const {
  classifyInventoryStatus,
  calculateAverageDailySales,
  calculateDaysRemaining,
  calculateRecommendedReorder,
} = require('../src/services/inventoryForecastService');

test('calculates average daily sales from a rolling window', () => {
  const sales = [20, 10, 30, 20];
  assert.equal(calculateAverageDailySales(sales, 30), 80 / 30);
});

test('keeps days remaining safe for zero sales', () => {
  assert.equal(calculateDaysRemaining(140, 0), Number.POSITIVE_INFINITY);
  assert.equal(calculateDaysRemaining(0, 7), 0);
});

test('classifies low and critical inventory correctly', () => {
  assert.equal(classifyInventoryStatus(20, 100), 'low');
  assert.equal(classifyInventoryStatus(10, 100), 'warning');
  assert.equal(classifyInventoryStatus(5, 100), 'critical');
  assert.equal(classifyInventoryStatus(0, 0), 'out_of_stock');
});

test('reorder quantity is never negative', () => {
  assert.equal(calculateRecommendedReorder({ currentStock: 100, avgDailySales: 12, leadTimeDays: 3, safetyStock: 20 }), 0);
  assert.equal(calculateRecommendedReorder({ currentStock: 5, avgDailySales: 4, leadTimeDays: 2, safetyStock: 6 }), 9);
});
