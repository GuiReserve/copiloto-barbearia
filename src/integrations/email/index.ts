/** Adaptador de e-mail. Nenhum provedor configurado na primeira versão. */
export interface EmailProvider { id: string; send(to: string, subject: string, body: string): Promise<boolean> }
export const email: EmailProvider = { id: 'nenhum', send: async () => false };
