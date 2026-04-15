import { v4 as uuidv4 } from 'uuid';
import type { OrderPayload, QuoteResult, Quote } from '../types';
import type { TeamsRepo } from '../db/teamsRepo';
import type { WindowsRepo } from '../db/windowsRepo';
import type { QuotesRepo } from '../db/quotesRepo';
import type { OrdersRepo } from '../db/ordersRepo';
import type { Clock } from '../clock';
import { formatIso } from '../clock';
import { haversineKm } from '../domain/geo';
import { fits } from '../domain/availability';
import { MAX_WINDOW_WEIGHT_KG, SERVICE_RADIUS_KM, QUOTE_TTL_MS } from '../config';

export class QuotingService {
  constructor(
    private teams: TeamsRepo,
    private windows: WindowsRepo,
    private quotes: QuotesRepo,
    private orders: OrdersRepo,
    private clock: Clock,
  ) {}

  getQuotes(order: OrderPayload): QuoteResult[] {
    const allTeams = this.teams.listAll();
    const eligibleTeams = allTeams.filter(
      t => haversineKm({ lat: order.lat, lng: order.lng }, { lat: t.lat, lng: t.lng }) <= SERVICE_RADIUS_KM,
    );
    if (eligibleTeams.length === 0) return [];

    const eligibleTeamIds = eligibleTeams.map(t => t.id);
    const candidateWindows = this.windows.findStartingInRange(order.min_time, order.max_time, eligibleTeamIds);
    if (candidateWindows.length === 0) return [];

    const usedWeights = this.orders.sumWeightByWindowIds(candidateWindows.map(w => w.id));
    const fittingWindows = candidateWindows.filter(w =>
      fits(order.weight, usedWeights.get(w.id) ?? 0, MAX_WINDOW_WEIGHT_KG),
    );
    if (fittingWindows.length === 0) return [];

    const now = this.clock.now();
    const createdAt = formatIso(now);
    const expiresAt = formatIso(new Date(now.getTime() + QUOTE_TTL_MS));

    const newQuotes: Quote[] = fittingWindows.map(w => ({
      id: uuidv4(),
      window_id: w.id,
      lng: order.lng,
      lat: order.lat,
      min_time: order.min_time,
      max_time: order.max_time,
      weight: order.weight,
      created_at: createdAt,
      expires_at: expiresAt,
    }));
    this.quotes.insertMany(newQuotes);

    return newQuotes.map((q, i) => ({
      quote_id: q.id,
      window_id: fittingWindows[i]!.id,
      team_id: fittingWindows[i]!.team_id,
      start_time: fittingWindows[i]!.start_time,
      end_time: fittingWindows[i]!.end_time,
      expires_at: q.expires_at,
    }));
  }
}
