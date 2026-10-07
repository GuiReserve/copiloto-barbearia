/** Adaptador do Google Business Profile. Hoje os números são lançados à mão em /marketing. */
export type GoogleDaily = { date: string; views: number; clicks: number; calls: number; routeRequests: number; siteVisits: number };
export interface GoogleProvider { id: string; fetchDaily(date: string): Promise<GoogleDaily | null> }
export const google: GoogleProvider = { id: 'manual', fetchDaily: async () => null };
