import { buildTestApp } from '../helpers/buildTestApp';
import { makeTeam, makeWindow, makeOrder, makeOrderPayload } from '../helpers/fixtures';

async function seedAndQuote() {
  const t = await buildTestApp();
  t.teams.insert(makeTeam());
  t.windows.insert(makeWindow({ id: 'w1', start_time: '2026-04-15 10:00:00', end_time: '2026-04-15 11:00:00' }));
  const res = await t.app.inject({ method: 'POST', url: '/get_quotes', payload: makeOrderPayload() });
  const quotes = (res.json() as { quotes: Array<{ quote_id: string }> }).quotes;
  return { ...t, quoteId: quotes[0]!.quote_id };
}

describe('POST /book_order', () => {
  it('returns 200 + order_id on happy path', async () => {
    const { app, quoteId, db } = await seedAndQuote();
    const res = await app.inject({
      method: 'POST', url: '/book_order',
      payload: { quote_id: quoteId, ...makeOrderPayload() },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { order_id: string }).order_id).toMatch(/^[0-9a-f-]{36}$/);
    await app.close();
    db.close();
  });

  it('returns 404 for unknown quote_id', async () => {
    const { app, db } = await buildTestApp();
    const res = await app.inject({
      method: 'POST', url: '/book_order',
      payload: { quote_id: 'nope', ...makeOrderPayload() },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'quote_not_found' });
    await app.close();
    db.close();
  });

  it('returns 410 on expired quote', async () => {
    const { app, clock, quoteId, db } = await seedAndQuote();
    clock.advanceMs(6 * 60 * 1000);
    const res = await app.inject({
      method: 'POST', url: '/book_order',
      payload: { quote_id: quoteId, ...makeOrderPayload() },
    });
    expect(res.statusCode).toBe(410);
    expect(res.json()).toEqual({ error: 'quote_expired' });
    await app.close();
    db.close();
  });

  it('returns 409 when window was filled after the quote was issued', async () => {
    const { app, orders, quoteId, db } = await seedAndQuote();
    orders.insert(makeOrder({ id: 'o-fill', window_id: 'w1', weight: 995 }));
    const res = await app.inject({
      method: 'POST', url: '/book_order',
      payload: { quote_id: quoteId, ...makeOrderPayload() },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'capacity_exceeded' });
    await app.close();
    db.close();
  });
});
