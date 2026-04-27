/**
 * Standalone test for direct Waitrose API access (no browser tab required).
 * Run with: npx tsx tests/test-direct-api.ts
 *
 * Credentials are read from credentials.json in the project root.
 * API key and flow reverse-engineered from the Waitrose Android app.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const API_KEY = 'EbUnxV2CRy3jZk1kgfwaY5K1zTSlnnpx9uHS8Oth';
const GRAPHQL_URL = 'https://www.waitrose.com/api/graphql-prod/graph/live';

// --- Credentials ---

const { username, password } = JSON.parse(
  readFileSync(join(import.meta.dirname, '..', 'credentials.json'), 'utf8')
);

// --- HTTP helpers ---

function headers(token: string): Record<string, string> {
  return {
    'content-type': 'application/json',
    'x-api-key': API_KEY,
    'authorization': `Bearer ${token}`,
    'user-agent': 'Waitrose/3.9.1.14114 Android',
    'breadcrumb': 'android-grocery-app',
    'client-correlation-id': crypto.randomUUID(),
  };
}

async function gql(token: string, query: string, variables?: unknown): Promise<any> {
  const res = await fetch(GRAPHQL_URL, {
    method: 'POST',
    headers: headers(token),
    body: JSON.stringify({ query, variables }),
  });
  const data = await res.json() as any;
  if (data.errors?.length) throw new Error(data.errors.map((e: any) => e.message).join(', '));
  return data.data;
}

// --- Tests ---

let pass = 0;
let fail = 0;

function check(name: string, value: unknown, assertion: (v: any) => boolean) {
  if (assertion(value)) {
    console.log(`  ✓ ${name}`);
    pass++;
  } else {
    console.log(`  ✗ ${name} — got: ${JSON.stringify(value)}`);
    fail++;
  }
}

// --- Step 1: Login ---

console.log('\n1. Login (generateSession)');
const loginData = await gql('unauthenticated', `
  mutation NewSession($input: SessionInput) {
    generateSession(session: $input) {
      accessToken refreshToken customerId customerOrderId expiresIn
      failures { type message }
    }
  }
`, { input: { username, password, clientId: 'ANDROID_APP' } });

const session = loginData?.generateSession;
check('no failures', session?.failures, f => !f?.length);
check('accessToken present', session?.accessToken, t => typeof t === 'string' && t.length > 0);
check('customerId present', session?.customerId, id => typeof id === 'string' && id.length > 0);
check('customerOrderId present', session?.customerOrderId, id => typeof id === 'string' && id.length > 0);

const token: string = session?.accessToken;
const orderId: string = session?.customerOrderId;
const customerId: string = session?.customerId;
console.log(`  → customerId: ${customerId}, orderId: ${orderId}`);

// --- Step 2: Get trolley ---

console.log('\n2. Get trolley');
const trolleyData = await gql(token, `
  query($orderId: ID!) {
    getTrolley(orderId: $orderId) {
      trolley {
        trolleyItems { trolleyItemId lineNumber quantity { amount uom } }
        trolleyTotals { itemTotalEstimatedCost { amount currencyCode } }
      }
    }
  }
`, { orderId });

const trolley = trolleyData?.getTrolley?.trolley;
check('trolley returned (may be empty)', trolley, t => t !== undefined);
const itemCount = trolley?.trolleyItems?.length ?? 0;
const total = trolley?.trolleyTotals?.itemTotalEstimatedCost?.amount ?? 0;
console.log(`  → ${itemCount} items, total: £${total.toFixed(2)}`);

// --- Step 3: Product search ---

console.log('\n3. Product search (semi-skimmed milk)');
const searchRes = await fetch(
  `https://www.waitrose.com/api/content-prod/v2/cms/publish/productcontent/search/${customerId}?clientType=WEB_APP`,
  {
    method: 'POST',
    headers: headers(token),
    body: JSON.stringify({
      customerSearchRequest: {
        queryParams: { searchTerm: 'semi-skimmed milk', size: 3, sortBy: 'MOST_POPULAR', searchTags: [], filterTags: [], orderId, categoryLevel: 1 },
      },
    }),
  }
);
const searchData = await searchRes.json() as any;
const products = (searchData.componentsAndProducts ?? []).filter((c: any) => c.searchProduct).map((c: any) => c.searchProduct);
check('search returns results', products, p => p.length > 0);
check('first result has name', products[0]?.name, n => typeof n === 'string');
console.log(`  → ${products.length} results, first: "${products[0]?.name}" @ ${products[0]?.displayPrice}`);

// --- Step 4: Product detail by lineNumber ---

console.log('\n4. Product detail lookup');
const lineNumber = products[0]?.lineNumber;
const productRes = await fetch(
  `https://www.waitrose.com/api/products-prod/v1/products/${lineNumber}?view=SUMMARY`,
  { method: 'GET', headers: headers(token) }
);
const productData = await productRes.json() as any;
const product = productData?.products?.[0] ?? productData;
check('product detail returned', product, p => !!p);
check('product has name', product?.name ?? product?.productName, n => typeof n === 'string');
console.log(`  → HTTP ${productRes.status}, keys: ${Object.keys(productData).join(', ')}`);

// --- Step 5: Order list ---

console.log('\n5. Order list');
const ordersRes = await fetch(
  'https://www.waitrose.com/api/order-orchestration-prod/v1/orders?size=5&sortBy=%2B&statuses=AMENDING%2BFULFIL%2BPAID%2BPAYMENT_FAILED%2BPICKED%2BPLACED',
  { method: 'GET', headers: headers(token) }
);
const ordersData = await ordersRes.json() as any;
const orders = ordersData.content ?? [];
check('orders returned', orders, o => Array.isArray(o));
console.log(`  → HTTP ${ordersRes.status}, ${orders.length} orders`);
if (orders[0]) console.log(`  → Most recent: ${orders[0].customerOrderId} (${orders[0].status})`);

// --- Step 6: Token refresh ---

console.log('\n6. Token refresh (RefreshSession)');
// refreshToken is passed as the Authorization Bearer header, not in the mutation body
const refreshData = await gql(session?.refreshToken, `
  mutation RefreshSession($input: SessionInput) {
    generateSession(session: $input) {
      accessToken refreshToken expiresIn failures { type message }
    }
  }
`, { input: { customerId, clientId: 'ANDROID_APP' } });

const refreshed = refreshData?.generateSession;
check('no failures', refreshed?.failures, f => !f?.length);
check('new accessToken present', refreshed?.accessToken, t => typeof t === 'string' && t.length > 0);
console.log(`  → expiresIn: ${refreshed?.expiresIn}s`);

// --- Summary ---

console.log(`\n${'─'.repeat(40)}`);
console.log(`Results: ${pass} passed, ${fail} failed`);
if (fail === 0) console.log('All checks passed — direct API is ready to use.');
else console.log('Some checks failed — review output above.');
