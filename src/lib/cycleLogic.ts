import { addDays, differenceInDays, format, parseISO, startOfDay, subDays, isWithinInterval } from 'date-fns';

export interface CycleEntry {
  id: string;
  startDate: string; // YYYY-MM-DD
  duration?: number;
  createdAt: any;
}

export interface DailyLog {
  id: string;
  date: string; // YYYY-MM-DD
  flow?: 'Léger' | 'Moyen' | 'Fort' | 'Aucun';
  sex?: 'Protégé' | 'Non-protégé' | 'Aucun';
  temperature?: number;
  lh_test?: 'Positif' | 'Négatif' | 'Non fait';
  mucus?: 'Sèche' | 'Collante' | 'Crémeuse' | 'Aqueuse' | 'Blanc d\'œuf';
  mood?: string;
  energy?: number; // 1-5
  weight?: number;
  symptoms?: string[];
  notes?: string;
  createdAt: any;
}

export const DEFAULT_CYCLE_LENGTH = 28;
export const LUTEAL_PHASE_LENGTH = 14;
export const SPERM_SURVIVAL_DAYS = 5;

/**
 * Calculates the average cycle length from a list of cycle entries.
 */
export function calculateAverageCycle(cycles: CycleEntry[]): number {
  if (cycles.length < 2) return DEFAULT_CYCLE_LENGTH;

  const sortedCycles = [...cycles].sort((a, b) => a.startDate.localeCompare(b.startDate));
  
  let totalDays = 0;
  let count = 0;

  for (let i = 1; i < sortedCycles.length; i++) {
    const prev = parseISO(sortedCycles[i - 1].startDate);
    const curr = parseISO(sortedCycles[i].startDate);
    totalDays += differenceInDays(curr, prev);
    count++;
  }

  return count > 0 ? Math.round(totalDays / count) : DEFAULT_CYCLE_LENGTH;
}

/**
 * Calculates the average period duration from daily logs.
 */
export function calculateAveragePeriodDuration(logs: DailyLog[]): number {
  const periodLogs = logs
    .filter(l => l.flow && l.flow !== 'Aucun')
    .sort((a, b) => a.date.localeCompare(b.date));
  
  if (periodLogs.length === 0) return 5;

  let totalDuration = 0;
  let periodCount = 0;
  let currentDuration = 1;

  for (let i = 1; i < periodLogs.length; i++) {
    const prev = parseISO(periodLogs[i - 1].date);
    const curr = parseISO(periodLogs[i].date);
    const diff = differenceInDays(curr, prev);

    if (diff === 1) {
      currentDuration++;
    } else {
      totalDuration += currentDuration;
      periodCount++;
      currentDuration = 1;
    }
  }
  
  totalDuration += currentDuration;
  periodCount++;

  return Math.round(totalDuration / periodCount);
}

/**
 * Predicts the next period dates for the next 3 months.
 */
export function getPredictions(lastCycleDate: string, avgLength: number) {
  const lastDate = parseISO(lastCycleDate);
  
  const predictions = [];
  for (let i = 1; i <= 3; i++) {
    const nextPeriodDate = addDays(lastDate, avgLength * i);
    const ovulationDate = subDays(nextPeriodDate, LUTEAL_PHASE_LENGTH);
    const fertilityStart = subDays(ovulationDate, SPERM_SURVIVAL_DAYS);
    const fertilityEnd = addDays(ovulationDate, 1);
    
    predictions.push({
      nextPeriodDate,
      ovulationDate,
      fertilityStart,
      fertilityEnd
    });
  }

  return predictions;
}

/**
 * Determines the risk level for a report at a given date.
 */
export function calculateRisk(date: Date, predictions: ReturnType<typeof getPredictions>): 'Faible' | 'Élevé' {
  const day = startOfDay(date);
  
  // High risk: Any prediction's fertility window
  const isFertile = predictions.some(p => 
    isWithinInterval(day, { start: p.fertilityStart, end: p.fertilityEnd })
  );
  
  return isFertile ? 'Élevé' : 'Faible';
}

/**
 * Determines the current cycle phase.
 */
export function getCyclePhase(today: Date, lastCycleDate: string, prediction: any) {
  const lastDate = parseISO(lastCycleDate);
  const daysSinceStart = differenceInDays(today, lastDate);
  
  if (daysSinceStart < 5) return 'Règles';
  if (today < prediction.fertilityStart) return 'Phase Folliculaire';
  if (isWithinInterval(today, { start: prediction.fertilityStart, end: prediction.fertilityEnd })) return 'Fenêtre de Fertilité';
  return 'Phase Lutéale';
}
