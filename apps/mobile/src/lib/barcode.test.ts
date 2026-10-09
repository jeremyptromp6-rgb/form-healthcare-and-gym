import { draftFromOpenFoodFacts, isValidGtin, lookupBarcode, normaliseBarcode } from './barcode';

// Shapes copied from real Open Food Facts v2 responses (trimmed to the fields FORM asks for).
const NUTELLA = {
  status: 1,
  product: {
    product_name: 'Nutella',
    brands: 'Nutella, Ferrero',
    quantity: '400 g e',
    product_quantity_unit: 'g',
    nutriments: { 'energy-kcal_100g': 539, proteins_100g: 6.3, carbohydrates_100g: 57.5, fat_100g: 30.9 },
  },
};
const COKE = {
  status: 1,
  product: {
    product_name: 'Coca-Cola Original',
    brands: 'COCA-COLA SERVICES SA/NV',
    quantity: '330 ml',
    product_quantity_unit: 'ml',
    serving_size: '1 portion (330 ml)',
    serving_quantity: 330,
    nutriments: { 'energy-kcal_100g': 42.4, proteins_100g: 0, carbohydrates_100g: 10.6, fat_100g: 0 },
  },
};

describe('barcodes', () => {
  it('checks GTIN check digits for EAN-8, UPC-A, EAN-13 and GTIN-14', () => {
    expect(isValidGtin('3017620422003')).toBe(true);
    expect(isValidGtin('5449000000996')).toBe(true);
    expect(isValidGtin('042100005264')).toBe(true);
    expect(isValidGtin('96385074')).toBe(true);
    expect(isValidGtin('3017620422004')).toBe(false);
    expect(isValidGtin('12345')).toBe(false);
    expect(isValidGtin('abcdefghijklm')).toBe(false);
  });

  it('keeps digits only, and expands a UPC-E code to UPC-A', () => {
    expect(normaliseBarcode(' 3017 6204-22003 ')).toBe('3017620422003');
    expect(normaliseBarcode('04252614', 'upc_e')).toBe('042100005264');
    expect(normaliseBarcode('04252614', 'ean8')).toBe('04252614');
  });
});

describe('draftFromOpenFoodFacts', () => {
  it('turns a food into a 100 g draft when there is no serving size', () => {
    expect(draftFromOpenFoodFacts('3017620422003', NUTELLA)).toEqual({
      ok: true,
      draft: { code: '3017620422003', name: 'Nutella', brand: 'Nutella', basis: 'g', servingLabel: '100 g', servingAmount: 100, perServing: { kcal: 539, proteinG: 6.3, carbsG: 57.5, fatG: 30.9 } },
    });
  });

  it('uses the listed serving, and millilitres for drinks', () => {
    const r = draftFromOpenFoodFacts('5449000000996', COKE);
    expect(r).toEqual({
      ok: true,
      draft: {
        code: '5449000000996',
        name: 'Coca-Cola Original',
        brand: 'COCA-COLA SERVICES SA/NV',
        basis: 'ml',
        servingLabel: '1 portion (330 ml)',
        servingAmount: 330,
        perServing: { kcal: 139.9, proteinG: 0, carbsG: 35, fatG: 0 },
      },
    });
  });

  it('converts kilojoules when calories are missing', () => {
    const r = draftFromOpenFoodFacts('1', { status: 1, product: { product_name: 'Crackers', nutriments: { 'energy-kj_100g': 1884, proteins_100g: 10 } } });
    expect(r.ok && r.draft.perServing.kcal).toBe(450.3);
  });

  it('says when a product is unknown or has no nutrition', () => {
    expect(draftFromOpenFoodFacts('1', { status: 0 })).toMatchObject({ ok: false, kind: 'not_found' });
    expect(draftFromOpenFoodFacts('1', null)).toMatchObject({ ok: false, kind: 'not_found' });
    expect(draftFromOpenFoodFacts('1', { status: 1, product: { product_name: 'Mystery', nutriments: {} } })).toMatchObject({ ok: false, kind: 'no_nutrition' });
  });

  it('keeps names, brands and serving labels within what a saved food allows', () => {
    const long = 'x'.repeat(200);
    const r = draftFromOpenFoodFacts('1', { status: 1, product: { product_name: long, brands: long, serving_size: long, serving_quantity: 50, nutriments: { 'energy-kcal_100g': 100 } } });
    expect(r.ok && [r.draft.name.length, r.draft.brand?.length, r.draft.servingLabel.length]).toEqual([80, 60, 40]);
  });

  it('ignores impossible serving sizes', () => {
    const r = draftFromOpenFoodFacts('1', { status: 1, product: { product_name: 'Bag', serving_quantity: 50_000, serving_size: 'whole bag', nutriments: { 'energy-kcal_100g': 500 } } });
    expect(r.ok && [r.draft.servingAmount, r.draft.servingLabel]).toEqual([100, '100 g']);
  });
});

describe('lookupBarcode', () => {
  const respond = (status: number, body: unknown) => jest.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

  it('asks Open Food Facts for just the fields it needs', async () => {
    const fetchMock = respond(200, NUTELLA);
    const r = await lookupBarcode('3017620422003', { fetch: fetchMock });
    expect(r.ok).toBe(true);
    const [url] = (fetchMock as unknown as jest.Mock).mock.calls[0];
    expect(url).toBe('https://world.openfoodfacts.org/api/v2/product/3017620422003.json?fields=code,product_name,brands,quantity,product_quantity_unit,serving_size,serving_quantity,nutriments');
  });

  it('rejects a misread code without calling out', async () => {
    const fetchMock = respond(200, NUTELLA);
    expect(await lookupBarcode('3017620422004', { fetch: fetchMock })).toMatchObject({ ok: false, kind: 'invalid' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    [429, 'rate_limited'],
    [404, 'not_found'],
    [500, 'network'],
  ] as const)('maps HTTP %s to %s', async (status, kind) => {
    expect(await lookupBarcode('3017620422003', { fetch: respond(status, {}) })).toMatchObject({ ok: false, kind });
  });

  it('expands an unlabelled UPC-E code, and tries a UPC-A code in its 13-digit form', async () => {
    const urls: string[] = [];
    const fetchMock = jest.fn(async (url: string) => {
      urls.push(url);
      return new Response(JSON.stringify(url.includes('/0042100005264.json') ? NUTELLA : { status: 0 }), { status: url.includes('/0042100005264.json') ? 200 : 404 });
    }) as unknown as typeof fetch;
    const r = await lookupBarcode('04252614', { fetch: fetchMock });
    expect(urls.map((u) => u.split('/product/')[1]!.split('.json')[0])).toEqual(['042100005264', '0042100005264']);
    expect(r).toMatchObject({ ok: true, draft: { code: '0042100005264', name: 'Nutella' } });
  });

  it('reports a connection failure', async () => {
    const failing = jest.fn(async () => Promise.reject(new TypeError('Network request failed'))) as unknown as typeof fetch;
    expect(await lookupBarcode('3017620422003', { fetch: failing })).toMatchObject({ ok: false, kind: 'network' });
  });
});
