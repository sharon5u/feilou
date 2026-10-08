// Verify route geometry, especially crossings of the international date line.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../dist/app.js'), 'utf8');
const start = source.indexOf('function flightPoints(');
const end = source.indexOf('function renderFlights(', start);
const context = {};
vm.createContext(context);
vm.runInContext(source.slice(start, end), context);
for (const [a,b] of [[-122.38,139.78],[139.78,-122.38],[179,-179],[-179,179],[2,10]]) {
  const points = context.flightPoints({origin_lat:37,origin_lng:a,destination_lat:35,destination_lng:b});
  assert.equal(points.length,49);
  assert.equal(points[0][1],a);
  assert(Math.abs(points.at(-1)[1]-a)<=180);
  assert(Math.abs(((points.at(-1)[1]-b)%360))<1e-8);
  for(let i=1;i<points.length;i++) {
    assert(points[i].every(Number.isFinite));
    assert(Math.abs(points[i][1]-points[i-1][1])<4);
  }
}
console.log('Route tests passed: both directions across the Pacific/date line and local route.');
