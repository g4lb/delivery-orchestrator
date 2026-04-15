import type { TeamsRepo } from './teamsRepo';
import type { WindowsRepo } from './windowsRepo';
import type { Team, DeliveryWindow } from '../shared/types';

const SEED_TEAMS: Team[] = [
  { id: 'team-tlv-north', name: 'Tel Aviv North', lng: 34.7818, lat: 32.0853 },
  { id: 'team-tlv-south', name: 'Tel Aviv South', lng: 34.77, lat: 32.05 },
  { id: 'team-ramat-gan', name: 'Ramat Gan', lng: 34.8236, lat: 32.0684 },
  { id: 'team-jerusalem', name: 'Jerusalem Central', lng: 35.2137, lat: 31.7683 },
];

const SEED_BASE_DATE = new Date('2026-04-15T00:00:00Z');
const SEED_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;
const SLOT_START_HOUR = 9;
const SLOT_END_HOUR = 18;

export function seed(teams: TeamsRepo, windows: WindowsRepo): void {
  for (const team of SEED_TEAMS) teams.insert(team);
  for (const window of generateAllWindows()) windows.insert(window);
}

function generateAllWindows(): DeliveryWindow[] {
  const result: DeliveryWindow[] = [];
  for (let dayOffset = 0; dayOffset < SEED_DAYS; dayOffset++) {
    const date = toDateString(dayOffset);
    for (const team of SEED_TEAMS) {
      result.push(...generateDayWindows(team, date));
    }
  }
  return result;
}

function generateDayWindows(team: Team, date: string): DeliveryWindow[] {
  const result: DeliveryWindow[] = [];
  for (let hour = SLOT_START_HOUR; hour < SLOT_END_HOUR; hour++) {
    result.push({
      id: `win-${team.id}-${date}-${pad2(hour)}`,
      team_id: team.id,
      start_time: `${date} ${pad2(hour)}:00:00`,
      end_time: `${date} ${pad2(hour + 1)}:00:00`,
    });
  }
  return result;
}

function toDateString(dayOffset: number): string {
  const day = new Date(SEED_BASE_DATE.getTime() + dayOffset * DAY_MS);
  return day.toISOString().slice(0, 10);
}

function pad2(n: number): string {
  return n.toString().padStart(2, '0');
}
