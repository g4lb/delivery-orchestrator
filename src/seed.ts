import type { TeamsRepo } from './db/teamsRepo';
import type { WindowsRepo } from './db/windowsRepo';
import type { Team } from './types';

const SEED_TEAMS: Team[] = [
  { id: 'team-tlv-north',   name: 'Tel Aviv North',   lng: 34.7818, lat: 32.0853 },
  { id: 'team-tlv-south',   name: 'Tel Aviv South',   lng: 34.7700, lat: 32.0500 },
  { id: 'team-ramat-gan',   name: 'Ramat Gan',        lng: 34.8236, lat: 32.0684 },
  { id: 'team-jerusalem',   name: 'Jerusalem Central', lng: 35.2137, lat: 31.7683 },
];

// Generates 1-hour slots from 09:00 to 18:00 on a given date, per team.
function generateWindowsForDate(date: string, teams: Team[]): Array<{
  id: string; team_id: string; start_time: string; end_time: string;
}> {
  const out: Array<{ id: string; team_id: string; start_time: string; end_time: string }> = [];
  for (const t of teams) {
    for (let hour = 9; hour < 18; hour++) {
      const hh = hour.toString().padStart(2, '0');
      const next = (hour + 1).toString().padStart(2, '0');
      out.push({
        id: `win-${t.id}-${date}-${hh}`,
        team_id: t.id,
        start_time: `${date} ${hh}:00:00`,
        end_time: `${date} ${next}:00:00`,
      });
    }
  }
  return out;
}

export function seed(teams: TeamsRepo, windows: WindowsRepo): void {
  for (const t of SEED_TEAMS) teams.insert(t);
  // Seed the next 7 days of windows from a fixed reference date.
  // Reference date is intentionally static so demos are reproducible.
  const base = new Date('2026-04-15T00:00:00Z');
  for (let d = 0; d < 7; d++) {
    const day = new Date(base.getTime() + d * 24 * 60 * 60 * 1000);
    const iso = day.toISOString().slice(0, 10); // "YYYY-MM-DD"
    for (const w of generateWindowsForDate(iso, SEED_TEAMS)) {
      windows.insert(w);
    }
  }
}
