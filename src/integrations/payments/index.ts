/** Adaptador de pagamentos (Pix, cartão). Nenhum provedor configurado na primeira versão. */
export interface PaymentProvider { id: string; createCharge(amount: number, description: string): Promise<{ url: string } | null> }
export const payments: PaymentProvider = { id: 'nenhum', createCharge: async () => null };
