import { requireSession } from '@/lib/auth';
import { withTenant } from '@/lib/db';
import { ROLES, TIMEZONES } from '@/lib/format';
import { TEMPLATE_KINDS, TEMPLATE_VARS } from '@/integrations/messaging';
import { ActionForm, Modal, Submit } from '@/components/ui';
import { HoursForm } from '@/components/hours';
import { saveHours } from '../barbeiros/actions';
import { addBlock, addSource, addUser, changeOwnPassword, removeBlock, resetUserPassword, saveShop, saveTemplate, toggleSource, toggleUser } from './actions';

const KIND: Record<string, string> = { bloqueio: 'Bloqueio', folga: 'Folga', feriado: 'Feriado' };

export default async function SettingsPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const s = await requireSession();
  const first = (await searchParams).inicio === '1';
  const admin = s.role === 'admin', staff = admin || s.role === 'recepcao';
  const d = await withTenant(s, async (tx) => ({
    st: (await tx.one(`select * from settings`))!,
    hours: await tx.q(`select weekday, opens::text, closes::text, break_start::text, break_end::text from work_hours where barber_id is null`),
    barbers: await tx.q(`select id, name from barbers where active order by name`),
    blocks: await tx.q(`select t.id, t.kind, t.reason, b.name barber, to_char(t.starts_at, 'DD/MM HH24:MI') de, to_char(t.ends_at, 'DD/MM HH24:MI') ate
                        from time_blocks t left join barbers b on b.id = t.barber_id where t.ends_at > now() order by t.starts_at limit 50`),
    users: admin ? await tx.q(`select u.id, u.name, u.email, u.role, u.active, b.name barber from users u left join barbers b on b.id = u.barber_id order by u.active desc, u.name`) : [],
    templates: admin ? await tx.q(`select kind, body from message_templates order by kind`) : [],
    sources: admin ? await tx.q(`select id, name, kind, active from marketing_sources order by active desc, name`) : [],
    log: admin ? await tx.q(`select a.action, a.ip, to_char(a.created_at, 'DD/MM HH24:MI') quando, u.name from audit_log a left join users u on u.id = a.user_id order by a.id desc limit 40`) : [],
  }));
  return (
    <div className="stack">
      <div className="page-head"><div><h1>Configurações</h1><p>{admin ? 'Dados da barbearia, horários, equipe e mensagens.' : 'Sua senha e os bloqueios de horário.'}</p></div></div>
      {first && <p className="notice ok">Conta criada. Para a agenda funcionar, confira o horário de funcionamento abaixo e depois cadastre <a href="/barbeiros">barbeiros</a> e <a href="/servicos">serviços</a>.</p>}

      {admin && (
        <section className="card"><h2>Barbearia</h2>
          <ActionForm action={saveShop} done="Configurações salvas.">
            <div className="form-2">
              <label className="field"><span>Nome</span><input name="name" defaultValue={s.shopName} required maxLength={80} /></label>
              <label className="field"><span>Telefone</span><input name="phone" defaultValue={d.st.phone ?? ''} inputMode="tel" /></label>
              <label className="field"><span>Fuso horário</span><select name="timezone" defaultValue={d.st.timezone}>{TIMEZONES.map((t) => <option key={t} value={t}>{t.replace('America/', '').replace('_', ' ')}</option>)}</select></label>
              <label className="field"><span>Grade da agenda (minutos)</span><input name="slot_minutes" type="number" min={5} max={120} step={5} defaultValue={d.st.slot_minutes} /></label>
              <label className="field"><span>Ao cancelar um horário</span>
                <select name="auto_offer" defaultValue={d.st.auto_offer}>
                  <option value="manual">Mostrar quem está na fila e eu escolho</option>
                  <option value="primeiro">Convidar automaticamente o primeiro da fila</option>
                  <option value="todos">Convidar automaticamente todos os compatíveis</option>
                </select></label>
              <label className="field"><span>Validade do convite de encaixe (minutos)</span><input name="offer_expiry_minutes" type="number" min={5} max={1440} defaultValue={d.st.offer_expiry_minutes} /></label>
              <label className="field"><span>Cliente inativo após (dias sem vir)</span><input name="inactive_days" type="number" min={7} max={365} defaultValue={d.st.inactive_days} /></label>
              <label className="field"><span>Cliente perdido após (dias sem vir)</span><input name="lost_days" type="number" min={14} max={730} defaultValue={d.st.lost_days} /></label>
              <label className="field"><span>Cliente VIP a partir de (atendimentos)</span><input name="vip_visits" type="number" min={2} max={500} defaultValue={d.st.vip_visits} /></label>
            </div>
            <div><Submit>Salvar configurações</Submit></div>
          </ActionForm>
        </section>
      )}

      {admin && <section className="card"><h2>Horário de funcionamento</h2><HoursForm action={saveHours} rows={d.hours as any} /></section>}

      {staff && (
        <section className="card"><div className="row between"><h2>Bloqueios, folgas e feriados</h2>
          <Modal label="Bloquear horário" title="Bloquear horário" className="btn btn-sm">
            <ActionForm action={addBlock}>
              <div className="form-2">
                <label className="field"><span>Tipo</span><select name="kind">{Object.entries(KIND).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
                <label className="field"><span>Quem</span><select name="barber_id"><option value="">Barbearia inteira</option>{d.barbers.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
                <label className="field"><span>Dia</span><input type="date" name="date" required /></label>
                <label className="field"><span>Até o dia</span><input type="date" name="date_end" /></label>
                <label className="field"><span>Das</span><input type="time" name="from" /></label>
                <label className="field"><span>Às</span><input type="time" name="to" /></label>
              </div>
              <p className="muted small">Sem horário, bloqueia o dia inteiro.</p>
              <label className="field"><span>Motivo</span><input name="reason" maxLength={120} /></label>
              <Submit>Bloquear</Submit>
            </ActionForm>
          </Modal></div>
          <div className="list">
            {d.blocks.map((b) => (
              <div className="item" key={b.id}>
                <span className="badge">{KIND[b.kind]}</span>
                <span className="grow">{b.de} até {b.ate} · {b.barber ?? 'Barbearia inteira'}{b.reason && <span className="muted"> · {b.reason}</span>}</span>
                <ActionForm action={removeBlock} className=""><input type="hidden" name="id" value={b.id} /><Submit className="btn btn-sm btn-danger">Remover</Submit></ActionForm>
              </div>
            ))}
            {!d.blocks.length && <p className="empty">Nenhum bloqueio futuro.</p>}
          </div>
        </section>
      )}

      {admin && (
        <section className="card"><div className="row between"><h2>Equipe</h2>
          <Modal label="Novo usuário" title="Novo usuário" className="btn btn-sm">
            <ActionForm action={addUser}>
              <label className="field"><span>Nome</span><input name="name" required maxLength={80} /></label>
              <label className="field"><span>E-mail</span><input name="email" type="email" required autoComplete="off" /></label>
              <div className="form-2">
                <label className="field"><span>Perfil</span><select name="role"><option value="recepcao">Recepção: agenda, clientes e fila</option><option value="barbeiro">Barbeiro: só a própria agenda</option><option value="admin">Admin: acesso a tudo</option></select></label>
                <label className="field"><span>Se for barbeiro, qual?</span><select name="barber_id"><option value="">Selecione</option>{d.barbers.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
              </div>
              <label className="field"><span>Senha provisória</span><input name="password" type="password" minLength={10} required autoComplete="new-password" /><small>Pelo menos 10 caracteres. Peça para a pessoa trocar no primeiro acesso.</small></label>
              <Submit>Criar usuário</Submit>
            </ActionForm>
          </Modal></div>
          <div className="list">
            {d.users.map((u) => (
              <div className="item" key={u.id}>
                <span className="grow"><strong>{u.name}</strong> <span className="badge">{ROLES[u.role]}{u.barber ? `: ${u.barber}` : ''}</span>{!u.active && <span className="badge b-cancelado">Desativado</span>}<br /><span className="muted small">{u.email}</span></span>
                <Modal label="Nova senha" title={`Nova senha para ${u.name}`} className="btn btn-sm">
                  <ActionForm action={resetUserPassword}><input type="hidden" name="id" value={u.id} />
                    <label className="field"><span>Nova senha</span><input name="password" type="password" minLength={10} required autoComplete="new-password" /><small>Todos os acessos abertos dessa pessoa são encerrados.</small></label>
                    <Submit>Redefinir senha</Submit>
                  </ActionForm>
                </Modal>
                {u.id !== s.userId && <ActionForm action={toggleUser} className=""><input type="hidden" name="id" value={u.id} /><Submit className="btn btn-sm">{u.active ? 'Desativar' : 'Reativar'}</Submit></ActionForm>}
              </div>
            ))}
          </div>
        </section>
      )}

      {admin && (
        <section className="card"><h2>Mensagens</h2>
          <p className="muted small">Campos que o sistema preenche: {TEMPLATE_VARS.map((x) => `{{${x}}}`).join(' ')}</p>
          <div className="list">
            {d.templates.map((t) => (
              <ActionForm action={saveTemplate} key={t.kind} done="Mensagem salva.">
                <input type="hidden" name="kind" value={t.kind} />
                <label className="field"><span>{TEMPLATE_KINDS[t.kind]}</span><textarea name="body" defaultValue={t.body} maxLength={1000} required /></label>
                <div><Submit className="btn btn-sm">Salvar mensagem</Submit></div>
              </ActionForm>
            ))}
          </div>
        </section>
      )}

      {admin && (
        <section className="card"><h2>De onde vêm os clientes</h2>
          <div className="chips">
            {d.sources.map((o) => (
              <ActionForm action={toggleSource} className="" key={o.id}><input type="hidden" name="id" value={o.id} />
                <Submit className={`btn btn-sm${o.active ? '' : ' btn-danger'}`}>{o.name}{o.active ? '' : ' (desativada)'}</Submit>
              </ActionForm>
            ))}
          </div>
          <p className="muted small">Toque em uma origem para ativar ou desativar.</p>
          <ActionForm action={addSource} className="row">
            <input name="name" placeholder="Nova origem, ex.: TikTok" maxLength={40} required aria-label="Nova origem" className="grow" />
            <Submit className="btn">Adicionar</Submit>
          </ActionForm>
        </section>
      )}

      <section className="card"><h2>Minha senha</h2>
        <ActionForm action={changeOwnPassword} done="Senha alterada. Os outros aparelhos foram desconectados.">
          <div className="form-2">
            <label className="field"><span>Senha atual</span><input name="current" type="password" required autoComplete="current-password" /></label>
            <label className="field"><span>Nova senha</span><input name="password" type="password" minLength={10} required autoComplete="new-password" /></label>
          </div>
          <div><Submit>Trocar senha</Submit></div>
        </ActionForm>
      </section>

      {admin && (
        <section className="card"><h2>Registro de atividades</h2>
          <div className="table-wrap"><table>
            <thead><tr><th>Quando</th><th>Quem</th><th>Ação</th><th className="hide-sm">IP</th></tr></thead>
            <tbody>{d.log.map((l, i) => <tr key={i}><td className="num nowrap">{l.quando}</td><td>{l.name ?? 'Cliente (link público)'}</td><td>{l.action}</td><td className="muted hide-sm">{l.ip}</td></tr>)}</tbody>
          </table></div>
        </section>
      )}
    </div>
  );
}
