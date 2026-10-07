/** Adaptador de métricas do Instagram. Hoje os números são lançados à mão em /marketing. */
export type DailyMetrics = { date: string; views: number; interactions: number; clicks: number; leads: number; followers?: number };
export interface InstagramProvider { id: string; fetchDaily(date: string): Promise<DailyMetrics | null> }
/** Troque por um provedor da Meta Graph API quando houver credenciais. */
export const instagram: InstagramProvider = { id: 'manual', fetchDaily: async () => null };
