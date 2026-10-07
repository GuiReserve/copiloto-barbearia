/** Vocabulário e identidade por tipo de negócio. O sistema é o mesmo; muda como ele fala e a cara dele. */
export type Kind = 'barbearia' | 'sobrancelha';
export const KINDS: Record<Kind, string> = { barbearia: 'Barbearia', sobrancelha: 'Studio de design de sobrancelhas' };
export const isKind = (k: unknown): k is Kind => k === 'barbearia' || k === 'sobrancelha';

const barbearia = {
  produto: 'Copiloto da Barbearia',
  negocio: 'barbearia', Negocio: 'Barbearia', oNegocio: 'a barbearia', ONegocio: 'A barbearia', doNegocio: 'da barbearia', noNegocio: 'na barbearia',
  suaNegocio: 'sua barbearia', minhaNegocio: 'minha barbearia', inteiro: 'Barbearia inteira', como: 'Como está a barbearia',
  pro: 'barbeiro', Pro: 'Barbeiro', pros: 'barbeiros', Pros: 'Barbeiros', estePro: 'este barbeiro', oPro: 'o barbeiro', doPro: 'do barbeiro',
  cadaPro: 'cada barbeiro', outroPro: 'outro barbeiro', qualquerPro: 'qualquer barbeiro', novoPro: 'Novo barbeiro', proPreferido: 'Barbeiro preferido',
  umPro: 'um barbeiro', osPros: 'os barbeiros', proPath: '/barbeiros',
  exServico: 'Corte + barba', exPrimeiro: 'Corte, R$ 40, 30 minutos', exEspecialidades: 'Degradê, barba desenhada', varPro: 'barbeiro', varNegocio: 'barbearia',
  pitch: ['Agenda e fila de espera no celular', 'Cancelou? O horário é oferecido para quem está esperando', 'Quanto entrou, quanto saiu e quanto vale a sua hora'],
};
const sobrancelha: typeof barbearia = {
  produto: 'Copiloto do Estúdio',
  negocio: 'estúdio', Negocio: 'Estúdio', oNegocio: 'o estúdio', ONegocio: 'O estúdio', doNegocio: 'do estúdio', noNegocio: 'no estúdio',
  suaNegocio: 'seu estúdio', minhaNegocio: 'meu estúdio', inteiro: 'Estúdio inteiro', como: 'Como está o estúdio',
  pro: 'profissional', Pro: 'Profissional', pros: 'profissionais', Pros: 'Profissionais', estePro: 'esta profissional', oPro: 'a profissional', doPro: 'da profissional',
  cadaPro: 'cada profissional', outroPro: 'outra profissional', qualquerPro: 'qualquer profissional', novoPro: 'Nova profissional', proPreferido: 'Profissional preferida',
  umPro: 'uma profissional', osPros: 'as profissionais', proPath: '/profissionais',
  exServico: 'Design com henna', exPrimeiro: 'Design de sobrancelhas, R$ 45, 30 minutos', exEspecialidades: 'Design personalizado, brow lamination, henna', varPro: 'profissional', varNegocio: 'estudio',
  pitch: ['Agenda online: a cliente marca sozinha pelo seu link', 'Desmarcou? O horário é oferecido para quem está na fila', 'Quem está na hora da manutenção e quem sumiu'],
};
export type Terms = typeof barbearia;
export const terms = (k: Kind | string | null | undefined): Terms => (k === 'sobrancelha' ? sobrancelha : barbearia);
