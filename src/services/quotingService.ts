import { v4 as uuidv4 } from 'uuid';
import type { OrderPayload, QuoteResult, Quote, Team, DeliveryWindow } from '../shared/types';
import type { TeamsRepo } from '../db/teamsRepo';
import type { WindowsRepo } from '../db/windowsRepo';
import type { QuotesRepo } from '../db/quotesRepo';
import type { OrdersRepo } from '../db/ordersRepo';
import type { Clock } from '../shared/clock';
import { formatIso } from '../shared/clock';
import { haversineKm } from '../domain/geo';
import { windowMatchesOrder } from '../domain/time';
import { fits } from '../domain/availability';
import { MAX_WINDOW_WEIGHT_KG, SERVICE_RADIUS_KM, QUOTE_TTL_MS } from '../config/config';

export class QuotingService {
  constructor(
    private teams: TeamsRepo,
    private windows: WindowsRepo,
    private quotes: QuotesRepo,
    private orders: OrdersRepo,
    private clock: Clock,
  ) {}

  getQuotes(order: OrderPayload): QuoteResult[] {
    const eligibleTeamIds = this.findEligibleTeamIds(order);
    if (eligibleTeamIds.length === 0) return [];

    const fittingWindows = this.findFittingWindows(order, eligibleTeamIds);
    if (fittingWindows.length === 0) return [];

    return this.createQuotesForWindows(order, fittingWindows);
  }

  private findEligibleTeamIds(order: OrderPayload): string[] {
    return this.teams
      .listAll()
      .filter(t => isTeamInRadius(t, order))
      .map(t => t.id);
  }

  private findFittingWindows(order: OrderPayload, teamIds: string[]): DeliveryWindow[] {
    const candidates = this.windows
      .findStartingInRange(order.min_time, order.max_time, teamIds)
      .filter(w => windowMatchesOrder(w, order));
    if (candidates.length === 0) return [];

    const usedWeights = this.orders.sumWeightByWindowIds(candidates.map(w => w.id));
    return candidates.filter(w =>
      fits(order.weight, usedWeights.get(w.id) ?? 0, MAX_WINDOW_WEIGHT_KG),
    );
  }

  private createQuotesForWindows(order: OrderPayload, windows: DeliveryWindow[]): QuoteResult[] {
    const now = this.clock.now();
    const createdAt = formatIso(now);
    const expiresAt = formatIso(new Date(now.getTime() + QUOTE_TTL_MS));

    const newQuotes: Quote[] = windows.map(w => buildQuote(w.id, order, createdAt, expiresAt));
    this.quotes.insertMany(newQuotes);

    return windows.map((w, i) => ({
      quote_id: newQuotes[i]!.id,
      window_id: w.id,
      team_id: w.team_id,
      start_time: w.start_time,
      end_time: w.end_time,
      expires_at: expiresAt,
    }));
  }
}

function isTeamInRadius(team: Team, order: OrderPayload): boolean {
  const distance = haversineKm(
    { lat: order.lat, lng: order.lng },
    { lat: team.lat, lng: team.lng },
  );
  return distance <= SERVICE_RADIUS_KM;
}

function buildQuote(windowId: string, order: OrderPayload, createdAt: string, expiresAt: string): Quote {
  return {
    id: uuidv4(),
    window_id: windowId,
    lng: order.lng,
    lat: order.lat,
    min_time: order.min_time,
    max_time: order.max_time,
    weight: order.weight,
    created_at: createdAt,
    expires_at: expiresAt,
  };
}
