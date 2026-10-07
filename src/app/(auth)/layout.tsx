export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="auth">
      <section className="auth-art">
        <p className="brand">Copiloto da Barbearia</p>
        <h1>Abra uma vez por dia e saiba como está a casa.</h1>
        <ul>
          <li>Agenda e fila de espera no celular</li>
          <li>Cancelou? O horário é oferecido para quem está esperando</li>
          <li>Quanto entrou, quanto saiu e quanto vale a sua hora</li>
        </ul>
      </section>
      <main className="auth-form">{children}</main>
    </div>
  );
}
