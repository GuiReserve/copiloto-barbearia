import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { withTenant } from '@/lib/db';
import { publicSession, publicShop } from '@/lib/public';
import { freeByBarber, startTimes } from '@/lib/slots';
import { today } from '@/lib/metrics';
import { addDays, brl, DIAS_CURTOS, dmy, hm, isDate, isUuid, longDate, toMin, weekday } from '@/lib/format';
import { ActionForm, Submit } from '@/components/ui';
import { book, joinQueue } from './actions';
import { terms } from '@/lib/terms';

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string>> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const shop = await publicShop((await params).slug);
  return { title: shop ? `Agendar na ${shop.name}` : 'Agendamento', robots: { index: true } };
}

function Who({ slug, s, d, b }: { slug: string; s: string; d: string; b?: string }) {
  return (
    <>
      <input type="hidden" name="slug" value={slug} /><input type="hidden" name="s" value={s} /><input type="hidden" name="d" value={d} />
      {b && <input type="hidden" name="b" value={b} />}
      <label className="field"><span>Seu nome</span><input name="name" autoComplete="name" required maxLength={60} /></label>
      <label className="field"><span>WhatsApp com DDD</span><input name="phone" type="tel" inputMode="tel" autoComplete="tel" required placeholder="(11) 91234-5678" /></label>
    </>
  );
}

/** Página pública: o cliente escolhe serviço, barbeiro, dia e horário. Sem conta, sem senha. */
export default async function BookingPage({ params, searchParams }: Props) {
  const { slug } = await params, sp = await searchParams;
  const shop = await publicShop(slug);
  if (!shop) notFound();
  const base = `/b/${slug}`, t = terms(shop.kind);
  const Shell = ({ children }: { children: React.ReactNode }) => (
    <div className="public-wrap" data-kind={shop.kind}><main className="public"><header><p className="brand">{shop.name}</p></header>{children}</main></div>
  );
  if (!shop.public_booking) return <Shell><div className="card stack-sm"><h1>Agendamento online indisponível</h1><p>Fale direto com {t.oNegocio} para marcar o seu horário{shop.phone ? `: ${shop.phone}` : '.'}</p></div></Shell>;

  const d = await withTenant(publicSession(shop), async (tx) => {
    const t = await today(tx), last = addDays(t, shop.booking_days);
    const services = await tx.q(`select s.id, s.name, s.price::float8 price, s.duration_min from services s where s.active
      and exists (select from barber_services bs join barbers b on b.id = bs.barber_id where bs.service_id = s.id and b.active) order by s.name`);
    const sv = isUuid(sp.s) ? services.find((x) => x.id === sp.s) : undefined;
    const barbers = sv ? await tx.q(`select b.id, b.name, b.specialties from barbers b join barber_services bs on bs.barber_id = b.id where b.active and bs.service_id = $1 order by b.name`, [sv.id]) : [];
    const pick = isUuid(sp.b) ? barbers.find((b) => b.id === sp.b) : undefined;
    const date = isDate(sp.d) && sp.d >= t && sp.d <= last ? sp.d : t;
    const times: { m: number; b: string }[] = [];
    if (sv && sp.d) {
      const { free } = await freeByBarber(tx, date, pick?.id ?? null);
      for (const b of pick ? [pick] : barbers)
        for (const m of startTimes(free.get(b.id) ?? [], sv.duration_min, shop.slot_minutes)) if (!times.some((x) => x.m === m)) times.push({ m, b: b.id });
      times.sort((x, y) => x.m - y.m);
    }
    return { t, services, sv, barbers, pick, date, times };
  });
  const { sv, pick, date } = d;

  if (sp.ok === '1' && sv && /^\d\d:\d\d$/.test(sp.h ?? '') && isDate(sp.d)) return (
    <Shell><div className="card stack-sm"><h1>Horário marcado</h1>
      <dl className="stats"><div className="stat lead"><dt>{longDate(sp.d)}</dt><dd>{sp.h}</dd></div><div className="stat"><dt>{sv.name}</dt><dd>{brl(sv.price)}</dd></div></dl>
      <p>Esperamos você. Se não puder vir, avise {t.oNegocio}{shop.phone ? ` pelo ${shop.phone}` : ''} para liberar o horário para outra pessoa.</p>
      <Link className="btn" href={base}>Marcar outro horário</Link></div></Shell>
  );
  if (sp.fila === '1') return (
    <Shell><div className="card stack-sm"><h1>Você está na fila de espera</h1>
      <p>Se abrir um horário{isDate(sp.d) ? ` no dia ${dmy(sp.d)}` : ''}, {t.oNegocio} avisa você pelo WhatsApp.</p>
      <Link className="btn" href={base}>Voltar</Link></div></Shell>
  );

  const q = (o: Record<string, string | undefined>) => `${base}?${new URLSearchParams(Object.entries({ s: sv?.id, b: pick?.id, d: sp.d ? date : undefined, ...o }).filter(([, x]) => x) as [string, string][])}`;
  const chosen = d.times.find((x) => /^\d\d:\d\d$/.test(sp.h ?? '') && x.m === toMin(sp.h));
  const days = Array.from({ length: Math.min(shop.booking_days, 21) + 1 }, (_, i) => addDays(d.t, i));

  return (
    <Shell>
      <h1>Marque o seu horário</h1>

      <section className="card stack-sm"><h2>1. Serviço</h2>
        {sv ? <div className="row between"><span><strong>{sv.name}</strong><br /><span className="muted small">{sv.duration_min} min · {brl(sv.price)}</span></span><Link className="btn btn-sm" href={base}>Trocar</Link></div>
          : d.services.length ? <div className="list">{d.services.map((x) => (
            <Link key={x.id} className="item pick" href={`${base}?s=${x.id}`}><span className="grow"><strong>{x.name}</strong><br /><span className="muted small">{x.duration_min} min</span></span><span className="num">{brl(x.price)}</span></Link>))}</div>
          : <p className="empty">{t.ONegocio} ainda não publicou os serviços.</p>}
      </section>

      {sv && (
        <section className="card stack-sm"><h2>2. Com quem e quando</h2>
          <nav className="seg" aria-label={t.Pro}>
            <Link href={q({ b: undefined, h: undefined })} aria-current={!pick ? 'true' : undefined}>Qualquer um</Link>
            {d.barbers.map((b) => <Link key={b.id} href={q({ b: b.id, h: undefined })} aria-current={pick?.id === b.id ? 'true' : undefined}>{b.name.split(' ')[0]}</Link>)}
          </nav>
          <div className="chips">
            {days.map((day) => <Link key={day} className={`chip${sp.d && day === date ? ' on' : ''}`} href={q({ d: day, h: undefined })}>{day === d.t ? 'Hoje' : `${DIAS_CURTOS[weekday(day)]} ${dmy(day)}`}</Link>)}
          </div>
        </section>
      )}

      {sv && sp.d && (
        <section className="card stack-sm"><h2>3. Horário: {longDate(date)}</h2>
          {d.times.length > 0 && <div className="chips">{d.times.map((x) => <Link key={x.m} className={`chip${chosen?.m === x.m ? ' on' : ''}`} href={q({ h: hm(x.m) })}>{hm(x.m)}</Link>)}</div>}
          {!d.times.length && (
            <>
              <p>Sem horário livre neste dia. Escolha outro dia acima ou entre na fila de espera: se alguém desmarcar, {t.oNegocio} chama você.</p>
              <ActionForm action={joinQueue}>
                <Who slug={slug} s={sv.id} d={date} b={pick?.id} />
                <div className="form-2">
                  <label className="field"><span>Posso a partir das</span><input type="time" name="from" defaultValue="09:00" required /></label>
                  <label className="field"><span>Até as</span><input type="time" name="to" defaultValue="19:00" required /></label>
                </div>
                <Submit>Entrar na fila de espera</Submit>
              </ActionForm>
            </>
          )}
        </section>
      )}

      {sv && chosen && (
        <section className="card stack-sm"><h2>4. Seus dados</h2>
          <p className="muted">{sv.name} com {d.barbers.find((b) => b.id === chosen.b)?.name}, {longDate(date)} às {hm(chosen.m)}.</p>
          <ActionForm action={book}>
            <Who slug={slug} s={sv.id} d={date} b={chosen.b} />
            <input type="hidden" name="h" value={hm(chosen.m)} />
            <Submit>Confirmar horário</Submit>
          </ActionForm>
          <p className="small muted">Seu nome e telefone são usados só por {shop.name} para falar sobre o seu horário.</p>
        </section>
      )}
    </Shell>
  );
}
