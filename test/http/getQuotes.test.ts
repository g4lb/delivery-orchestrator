import { buildTestApp } from '../helpers/buildTestApp';
import { makeTeam, makeWindow, makeOrderPayload } from '../helpers/fixtures';

describe('GET /get_quotes', () => {
  it('returns 200 with quotes for a plausible seeded fixture', async () => {
    const { app, teams, windows, db } = await buildTestApp();
    teams.insert(makeTeam());
    windows.insert(makeWindow({ id: 'w1', start_time: '2026-04-15 10:00:00', end_time: '2026-04-15 11:00:00' }));

    const res = await app.inject({ method: 'POST', url: '/get_quotes', payload: makeOrderPayload() });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { quotes: Array<{ quote_id: string; window_id: string }> };
    expect(body.quotes).toHaveLength(1);
    expect(body.quotes[0]!.window_id).toBe('w1');
    await app.close();
    db.close();
  });

  it('returns 400 on missing weight field', async () => {
    const { app, db } = await buildTestApp();
    const { weight, ...bad } = makeOrderPayload();
    void weight;
    const res = await app.inject({ method: 'POST', url: '/get_quotes', payload: bad });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'invalid_payload' });
    await app.close();
    db.close();
  });

  it('returns 200 with empty array when nothing matches', async () => {
    const { app, db } = await buildTestApp();
    const res = await app.inject({ method: 'POST', url: '/get_quotes', payload: makeOrderPayload() });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ quotes: [] });
    await app.close();
    db.close();
  });
});
