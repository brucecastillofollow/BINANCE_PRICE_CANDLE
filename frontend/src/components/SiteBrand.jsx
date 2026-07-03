export default function SiteBrand({ title, subtitle, action }) {
  return (
    <div className="site-brand-row">
      <div className="site-brand">
        <img src="/logo.svg" alt="Weien Wong" width="40" height="40" className="site-logo" />
        <div>
          <div className="site-brand-name">Weien Wong</div>
          <h1>{title}</h1>
          {subtitle ? <p className="subtitle">{subtitle}</p> : null}
        </div>
      </div>
      {action ? <div className="site-brand-action">{action}</div> : null}
    </div>
  );
}
