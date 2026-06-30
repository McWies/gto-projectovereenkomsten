import { useState, useEffect, useRef } from 'react'
import { getData, saveData, uid } from './data'
import './App.css'

const ENTS = {
  nl: { naam: 'GTO Nederland', kvknr: '66192374', btwnr: 'NL856435703B01', adres: 'Europaplein 1, 5684 ZC Best', email: 'info@gtonederland.nl', web: 'www.gtonederland.nl', signer_zzp: 'J. Janssen', signer_klant: 'J.M.P.H. Janssen', fmail: 'facturen@gtonederland.nl', logo: '/logo-nederland.jpg', model_ref: 'nr: 90821.25537.3.0 | 30-04-2021 van de belastingdienst', bedrijfsnaam_zzp: 'Gras Technische Ondersteuning B.V.', bedrijfsnaam_klant: 'Gras Technische Ondersteuning B.V.', persnr_prefix: '' },
  west: { naam: 'GTO West', kvknr: '72180080', btwnr: 'NL859017898B01', adres: 'Europaplein 1, 5684 ZC Best', email: 'info@gtowest.nl', web: 'www.gtonederland.nl', signer_zzp: 'E. Gras', signer_klant: 'i.o. D.M. van Lith', fmail: 'facturen@gtowest.nl', logo: '/logo-west.jpg', model_ref: 'nr: 90821.25537.3.0 | 30-04-2021 van de belastingdienst', bedrijfsnaam_zzp: 'Gras Technical Support west B.V.', bedrijfsnaam_klant: 'Gras Technical Support west B.V.', persnr_prefix: 'W' }
}

// Backend API voor het genereren van Word/PDF overeenkomsten (Render)
const API_URL = 'https://gto-projectovereenkomsten.onrender.com'

// Converteer NL datumformaat (DD-MM-JJJJ uit form.start) naar de twee formaten die de backend nodig heeft
function dateToNl(isoDate) {
  if (!isoDate) return ''
  const [y, m, d] = isoDate.split('-')
  return `${d}-${m}-${y}`
}

async function downloadOvereenkomsten({ ent, selKlant, selProj, selMons, form, tarieven, toast }) {
  const persoonsnummerVoorMonteur = (m) => getPersnr(m, ent)

  const monteursPayload = selMons.map(m => ({
    id: m.id,
    naam: m.naam,
    handelsnaam: m.handelsnaam,
    kvk: m.kvk,
    adres: m.adres || '',
    persnr: persoonsnummerVoorMonteur(m),
  }))

  const tarievenPayload = {}
  selMons.forEach(m => {
    tarievenPayload[m.id] = {
      zzp: tarieven[`${m.id}_zzp`] || '',
      klant: tarieven[`${m.id}_kl`] || '',
      reisuur: tarieven[`${m.id}_reis`] || '',
    }
  })

  const tb = selKlant.tekenbevoegden.find(t => t.id === selProj.tb_id) || selKlant.tekenbevoegden[0] || { naam: '' }

  const payload = {
    entiteit: ent,
    monteurs: monteursPayload,
    klant: {
      naam: selKlant.naam,
      adres: selKlant.adres,
      kvk: selKlant.kvk,
      btw: selKlant.btw || '',
      contact: selKlant.contact || '',
      fmail: selKlant.fmail || '',
    },
    project: {
      nr: selProj.nr,
      naam: selProj.naam || '',
      werkadres: selProj.werkadres || '',
    },
    tekenbevoegde: tb.naam,
    startdatum_nl: dateToNl(form.start),
    startdatum_iso: form.start || new Date().toISOString().slice(0, 10),
    handtekendatum_nl: dateToNl(form.signdate),
    tarieven_per_monteur: tarievenPayload,
    opdrachtomschrijving: form.omschr || selProj.omschr || '',
  }

  toast('Overeenkomsten worden gegenereerd...')

  try {
    const res = await fetch(`${API_URL}/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      toast(`Fout: ${err.error || 'genereren mislukt'}`)
      return
    }

    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `Overeenkomsten ${selKlant.naam} ${selProj.nr}.zip`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    toast('Download gestart')
  } catch (e) {
    toast('Kon geen verbinding maken met de generator. Probeer het zo nogmaals (server kan opstarten).')
  }
}

function av(naam) { return (naam || '??').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase() }
function fmtDate(v) { if (!v) return '[datum]'; const [y, m, d] = v.split('-'); return `${d}-${m}-${y}` }
function fmtEuro(v) { if (!v || isNaN(v)) return '[tarief]'; return '€ ' + parseFloat(v).toFixed(2) }

// Haal het juiste persoonsnummer op voor een monteur in een entiteit
function getPersnr(mon, ent) {
  if (ent === 'west') return mon.persnr_west || mon.persnr || ''
  return mon.persnr_nl || mon.persnr || ''
}

function isWestPersnr(persnr) { return persnr && persnr.toString().startsWith('W') }

export default function App() {
  const [db, setDb] = useState(null)
  const [screen, setScreen] = useState('dashboard')
  const [notify, setNotify] = useState('')

  useEffect(() => { setDb(getData()) }, [])

  function save(newDb) { setDb({ ...newDb }); saveData(newDb) }
  function toast(msg) { setNotify(msg); setTimeout(() => setNotify(''), 2800) }

  if (!db) return <div style={{ padding: 40, fontFamily: 'Arial' }}>Laden...</div>

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="sb-logo">
          <img src="/logo-nederland.jpg" alt="GTO" style={{ height: 40, objectFit: 'contain' }} />
          <div><div className="sb-name">Overeenkomsten</div><div className="sb-sub">Beheerplatform</div></div>
        </div>
        <div className="nav-sec">Menu</div>
        {[['dashboard','Dashboard'],['nieuw','Nieuwe overeenkomst']].map(([id, lbl]) =>
          <div key={id} className={`nav-item ${screen === id ? 'active' : ''}`} onClick={() => setScreen(id)}>
            <span className="nav-dot" />{lbl}
          </div>
        )}
        <div className="nav-sec">Beheer</div>
        {[['monteurs','Monteurs'],['klanten','Klanten & projecten'],['instellingen','Instellingen']].map(([id, lbl]) =>
          <div key={id} className={`nav-item ${screen === id ? 'active' : ''}`} onClick={() => setScreen(id)}>
            <span className="nav-dot" />{lbl}
          </div>
        )}
      </aside>

      <div className="main">
        <div className="topbar">
          <div>
            <div className="tb-title">{{ dashboard:'Dashboard', nieuw:'Nieuwe overeenkomst', monteurs:'Monteurs', klanten:'Klanten & projecten', instellingen:'Instellingen' }[screen]}</div>
            <div className="tb-sub">GTO Overeenkomsten Platform</div>
          </div>
          <button className="btn btn-primary btn-sm" onClick={() => setScreen('nieuw')}>+ Nieuwe overeenkomst</button>
        </div>
        <div className="content">
          {screen === 'dashboard'    && <Dashboard db={db} setScreen={setScreen} />}
          {screen === 'nieuw'        && <NieuweOvereenkomst db={db} save={save} toast={toast} />}
          {screen === 'monteurs'     && <MonteursScreen db={db} save={save} toast={toast} />}
          {screen === 'klanten'      && <KlantenScreen db={db} save={save} toast={toast} />}
          {screen === 'instellingen' && <InstellingenScreen db={db} save={save} toast={toast} />}
        </div>
      </div>
      {notify && <div className="toast">{notify}</div>}
    </div>
  )
}

// ── DASHBOARD ─────────────────────────────────────────────────────────────
function Dashboard({ db, setScreen }) {
  const totalProj = db.klanten.reduce((a, k) => a + k.projecten.length, 0)
  return (
    <div>
      <div className="stat-grid">
        <div className="stat"><div className="stat-val">{db.monteurs.length}</div><div className="stat-lbl">Monteurs</div></div>
        <div className="stat"><div className="stat-val">{db.klanten.length}</div><div className="stat-lbl">Klanten</div></div>
        <div className="stat"><div className="stat-val">{totalProj}</div><div className="stat-lbl">Projecten</div></div>
        <div className="stat"><div className="stat-val">{db.recent.length}</div><div className="stat-lbl">Gegenereerd</div></div>
      </div>
      <div className="card">
        <div className="card-hdr"><span>Recente overeenkomsten</span></div>
        {!db.recent.length
          ? <div className="empty">Nog geen overeenkomsten gegenereerd. <span className="link" onClick={() => setScreen('nieuw')}>Start hier →</span></div>
          : db.recent.slice(-10).reverse().map(r => (
            <div key={r.id} className="list-item">
              <div className="av av-or">{av(r.monteur)}</div>
              <div className="pinfo"><div className="pname">{r.monteur} — {r.klant}</div><div className="psub">{r.projnr} · {r.entiteit} · {r.datum}</div></div>
            </div>
          ))
        }
      </div>
    </div>
  )
}

// ── NIEUWE OVEREENKOMST ───────────────────────────────────────────────────
function NieuweOvereenkomst({ db, save, toast }) {
  const [step, setStep] = useState(1)
  const [ent, setEnt] = useState('nl')
  const [selKlant, setSelKlant] = useState(null)
  const [selProj, setSelProj] = useState(null)
  const [selMons, setSelMons] = useState([])
  const [prevMon, setPrevMon] = useState(null)
  const [form, setForm] = useState({ start: '', signdate: '', omschr: '' })
  const [tarieven, setTarieven] = useState({})
  const [docTab, setDocTab] = useState('zzp')
  const [zoekKlant, setZoekKlant] = useState('')
  const [zoekMon, setZoekMon] = useState('')
  const [persnrModal, setPersnrModal] = useState(null) // monteur waarvoor persnr ontbreekt
  const [persnrInput, setPersnrInput] = useState('')
  const [downloading, setDownloading] = useState(false)
  const topRef = useRef(null)

  async function handleDownload() {
    setDownloading(true)
    await downloadOvereenkomsten({ ent, selKlant, selProj, selMons, form, tarieven, toast })
    setDownloading(false)
  }

  function scrollTop() { topRef.current?.scrollIntoView({ behavior: 'smooth' }) }

  function goStep(n) { setStep(n); scrollTop() }

  function pickKlant(k) { setSelKlant(k); setSelProj(null) }
  function pickProj(p) { setSelProj(p); setForm(f => ({ ...f, omschr: p.omschr })) }

  function toggleMon(m) {
    setSelMons(prev => prev.find(x => x.id === m.id) ? prev.filter(x => x.id !== m.id) : [...prev, m])
  }

  function setTarief(monId, field, val) { setTarieven(t => ({ ...t, [`${monId}_${field}`]: val })) }

  // Controleer persoonsnummers voor de gekozen entiteit
  function checkPersnrs() {
    const missing = selMons.find(m => !getPersnr(m, ent))
    if (missing) {
      setPersnrModal(missing)
      setPersnrInput('')
      return false
    }
    return true
  }

  function savePersnr() {
    if (!persnrInput.trim()) return
    const nr = persnrInput.trim()
    const updated = db.monteurs.map(m => {
      if (m.id !== persnrModal.id) return m
      if (ent === 'west') return { ...m, persnr_west: nr }
      return { ...m, persnr_nl: nr }
    })
    save({ ...db, monteurs: updated })
    // Update ook in selMons
    setSelMons(prev => prev.map(m => m.id !== persnrModal.id ? m : ent === 'west' ? { ...m, persnr_west: nr } : { ...m, persnr_nl: nr }))
    toast('Persoonsnummer opgeslagen')
    setPersnrModal(null)
    // Ga door naar genereren als alles ok is
    setTimeout(() => {
      const stillMissing = selMons.find(m => m.id !== persnrModal.id && !getPersnr(m, ent))
      if (!stillMissing) generate(true)
    }, 100)
  }

  function generate(skipCheck = false) {
    if (!selKlant || !selProj || !selMons.length) return
    if (!skipCheck && !checkPersnrs()) return
    const rec = {
      id: uid(),
      monteur: selMons.map(m => m.naam).join(', '),
      klant: selKlant.naam,
      projnr: `${selProj.nr} + ${selMons.map(m => getPersnr(m, ent)).join(', ')}`,
      entiteit: ENTS[ent].naam,
      datum: new Date().toLocaleDateString('nl-NL')
    }
    save({ ...db, recent: [...db.recent, rec] })
    setPrevMon(selMons[0])
    goStep(5)
    toast('Overeenkomst gegenereerd')
  }

  const e = ENTS[ent]
  const filteredKlanten = db.klanten.filter(k => k.naam.toLowerCase().includes(zoekKlant.toLowerCase()))
  const filteredMons = db.monteurs.filter(m =>
    m.naam.toLowerCase().includes(zoekMon.toLowerCase()) ||
    (m.handelsnaam || '').toLowerCase().includes(zoekMon.toLowerCase())
  )

  // Nav knoppen — altijd zichtbaar bovenaan en onderaan
  function NavRow({ back, backLabel, next, nextLabel, nextDisabled }) {
    return (
      <div className="nav-row">
        {back ? <button className="btn btn-sm" onClick={() => goStep(back)}>← {backLabel || 'Terug'}</button> : <span />}
        {next && <button className="btn btn-primary btn-sm" onClick={() => goStep(next)} disabled={nextDisabled}>{nextLabel || 'Volgende'} →</button>}
        {next === 'gen' && <button className="btn btn-primary btn-sm" onClick={() => generate()}>Genereer overeenkomst →</button>}
      </div>
    )
  }

  return (
    <div>
      <div ref={topRef} />

      {/* STEP BAR — klikbaar */}
      <div className="step-bar">
        {['Entiteit','Klant & project','Monteurs','Tarieven & datum','Overeenkomst'].map((lbl, i) => (
          <div key={i} className={`step ${step > i+1 ? 'done clickable' : step === i+1 ? 'active' : ''}`}
               onClick={() => { if (step > i+1) goStep(i+1) }}>
            <div className="step-num">{step > i+1 ? '✓' : i+1}</div>
            <div className="step-lbl">{lbl}</div>
            {i < 4 && <div className="step-line" />}
          </div>
        ))}
      </div>

      {/* STAP 1 — Entiteit */}
      {step === 1 && (
        <div className="card">
          <div className="card-hdr">Kies entiteit</div>
          <NavRow next={2} />
          <div className="ent-toggle" style={{ margin: '12px 0' }}>
            <button className={`ent-btn ${ent === 'nl' ? 'act-nl' : ''}`} onClick={() => setEnt('nl')}>
              <img src="/logo-nederland.jpg" alt="NL" style={{ height: 32, objectFit: 'contain' }} />GTO Nederland
            </button>
            <button className={`ent-btn ${ent === 'west' ? 'act-west' : ''}`} onClick={() => setEnt('west')}>
              <img src="/logo-west.jpg" alt="West" style={{ height: 32, objectFit: 'contain' }} />GTO West
            </button>
          </div>
          <NavRow next={2} />
        </div>
      )}

      {/* STAP 2 — Klant & project */}
      {step === 2 && (
        <div className="card">
          <div className="card-hdr">Klant & project</div>
          <NavRow back={1} next={3} nextDisabled={!selKlant || !selProj} />
          <div className="form-grid-2" style={{ marginTop: 12 }}>
            <div>
              <div className="flbl" style={{ marginBottom: 6 }}>Klant</div>
              <input className="finput" placeholder="🔍 Zoek klant..." value={zoekKlant}
                onChange={e => setZoekKlant(e.target.value)} style={{ marginBottom: 8 }} />
              <div style={{ maxHeight: 320, overflowY: 'auto' }}>
                {filteredKlanten.map(k => (
                  <div key={k.id} className={`list-item clickable ${selKlant?.id === k.id ? 'selected' : ''}`} onClick={() => pickKlant(k)}>
                    <div className="av av-coral">{av(k.naam)}</div>
                    <div className="pinfo"><div className="pname">{k.naam}</div><div className="psub">{k.contact}</div></div>
                    {k.afw.length > 0 && <span className="badge badge-afw">Afw.</span>}
                  </div>
                ))}
              </div>
            </div>
            <div>
              <div className="flbl" style={{ marginBottom: 6 }}>Project {!selKlant && <span style={{ color: '#bbb', fontWeight: 400 }}>(selecteer eerst klant)</span>}</div>
              <div style={{ opacity: selKlant ? 1 : 0.4, pointerEvents: selKlant ? 'auto' : 'none', maxHeight: 360, overflowY: 'auto' }}>
                {selKlant?.projecten.map(p => (
                  <div key={p.id} className={`list-item clickable ${selProj?.id === p.id ? 'selected' : ''}`} onClick={() => pickProj(p)}>
                    <div className="proj-icon">📁</div>
                    <div className="pinfo"><div className="pname">{p.naam}</div><div className="psub">Nr: {p.nr} · {p.werkadres}</div></div>
                  </div>
                ))}
                {selKlant && !selKlant.projecten.length && <div className="empty">Geen projecten</div>}
              </div>
            </div>
          </div>
          {selKlant?.afw.length > 0 && (
            <div className="afw-box" style={{ marginTop: 10 }}>
              <div className="afw-title">⚠ Klantspecifieke afwijkingen actief</div>
              {selKlant.afw.map((a, i) => <div key={i} className="afw-item">{a}</div>)}
            </div>
          )}
          <NavRow back={1} next={3} nextDisabled={!selKlant || !selProj} />
        </div>
      )}

      {/* STAP 3 — Monteurs */}
      {step === 3 && (
        <div className="card">
          <div className="card-hdr">Selecteer monteurs <span style={{ fontSize: 11, fontWeight: 400, color: '#999' }}>— meerdere mogelijk</span></div>
          <NavRow back={2} next={4} nextDisabled={!selMons.length} />
          <div className="tag-list" style={{ margin: '8px 0' }}>
            {selMons.map(m => <span key={m.id} className="tag">{m.naam} <span className="tag-x" onClick={() => toggleMon(m)}>×</span></span>)}
          </div>
          <input className="finput" placeholder="🔍 Zoek monteur of bedrijf..." value={zoekMon}
            onChange={e => setZoekMon(e.target.value)} style={{ marginBottom: 8 }} />
          <div style={{ maxHeight: 380, overflowY: 'auto' }}>
            {filteredMons.map(m => {
              const isSel = selMons.find(x => x.id === m.id)
              const persnr = getPersnr(m, ent)
              const heeftPersnr = !!persnr
              return (
                <div key={m.id} className={`list-item clickable ${isSel ? 'selected' : ''}`} onClick={() => toggleMon(m)}>
                  <div className={`chk ${isSel ? 'on' : ''}`} />
                  <div className="av av-blue">{av(m.naam)}</div>
                  <div className="pinfo">
                    <div className="pname">{m.naam}</div>
                    <div className="psub">{m.handelsnaam} · #{persnr || <span style={{ color: '#e8651a' }}>ontbreekt voor {e.naam}</span>}</div>
                  </div>
                  {heeftPersnr
                    ? <span className={`badge ${isWestPersnr(persnr) ? 'badge-west' : 'badge-nl'}`}>#{persnr}</span>
                    : <span className="badge badge-afw">Nr ontbreekt</span>
                  }
                </div>
              )
            })}
          </div>
          <NavRow back={2} next={4} nextDisabled={!selMons.length} />
        </div>
      )}

      {/* STAP 4 — Tarieven & datum */}
      {step === 4 && (
        <div className="card">
          <div className="card-hdr">Tarieven & datum</div>
          <NavRow back={3} next="gen" />
          <div className="summ" style={{ margin: '10px 0' }}>
            <strong>{e.naam}</strong> · Klant: <strong>{selKlant?.naam}</strong> · Project: <strong>{selProj?.naam}</strong> ({selProj?.nr})<br />
            Monteurs: <strong>{selMons.map(m => m.naam).join(', ')}</strong>
          </div>
          {selMons.map(m => {
            const persnr = getPersnr(m, ent)
            return (
              <div key={m.id} style={{ background: '#f8f8f8', borderRadius: 6, padding: '10px 12px', marginBottom: 8 }}>
                <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
                  {m.naam}
                  <span className={`badge ${isWestPersnr(persnr) ? 'badge-west' : 'badge-nl'}`}>#{persnr || '?'}</span>
                  {!persnr && <span style={{ fontSize: 11, color: '#e8651a' }}>⚠ Persoonsnummer ontbreekt — wordt gevraagd bij genereren</span>}
                </div>
                <div className="form-grid-3">
                  <div className="fg"><label className="flbl">Uurtarief monteur (€)</label><input className="finput" type="number" step="0.01" placeholder="45.00" value={tarieven[`${m.id}_zzp`] || ''} onChange={ev => setTarief(m.id, 'zzp', ev.target.value)} /></div>
                  <div className="fg"><label className="flbl">Uurtarief klant (€)</label><input className="finput" type="number" step="0.01" placeholder="54.00" value={tarieven[`${m.id}_kl`] || ''} onChange={ev => setTarief(m.id, 'kl', ev.target.value)} /></div>
                  <div className="fg"><label className="flbl">Reisuur (€, optioneel)</label><input className="finput" type="number" step="0.01" placeholder="22.50" value={tarieven[`${m.id}_reis`] || ''} onChange={ev => setTarief(m.id, 'reis', ev.target.value)} /></div>
                </div>
              </div>
            )
          })}
          <div className="form-grid-2" style={{ marginTop: 10 }}>
            <div className="fg"><label className="flbl">Startdatum</label><input className="finput" type="date" value={form.start} onChange={ev => setForm(f => ({ ...f, start: ev.target.value }))} /></div>
            <div className="fg"><label className="flbl">Datum handtekening</label><input className="finput" type="date" value={form.signdate} onChange={ev => setForm(f => ({ ...f, signdate: ev.target.value }))} /></div>
          </div>
          <div className="fg" style={{ marginTop: 8 }}>
            <label className="flbl">Opdrachtomschrijving <span style={{ fontWeight: 400, color: '#bbb' }}>(pre-ingevuld, aanpasbaar)</span></label>
            <textarea className="finput" rows={3} style={{ resize: 'vertical' }} value={form.omschr} onChange={ev => setForm(f => ({ ...f, omschr: ev.target.value }))} />
          </div>
          <NavRow back={3} next="gen" />
        </div>
      )}

      {/* STAP 5 — Preview */}
      {step === 5 && prevMon && (
        <div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
            <button className="btn btn-sm" onClick={() => goStep(4)}>← Aanpassen</button>
            <button className="btn btn-primary btn-sm" disabled={downloading} onClick={handleDownload}>
              {downloading ? '⏳ Bezig met genereren...' : '⬇ Download overeenkomsten (ZIP)'}
            </button>
          </div>
          {selMons.length > 1 && (
            <div className="tabs" style={{ marginBottom: 8 }}>
              {selMons.map(m => <button key={m.id} className={`tab ${prevMon?.id === m.id ? 'active' : ''}`} onClick={() => setPrevMon(m)}>{m.naam.split(' ')[0]}</button>)}
            </div>
          )}
          <div className="tabs">
            <button className={`tab ${docTab === 'zzp' ? 'active' : ''}`} onClick={() => setDocTab('zzp')}>ZZP overeenkomst</button>
            <button className={`tab ${docTab === 'klant' ? 'active' : ''}`} onClick={() => setDocTab('klant')}>Klant overeenkomst</button>
          </div>
          {docTab === 'zzp' && <POPreview type="zzp" ent={e} mon={prevMon} klant={selKlant} proj={selProj} form={form} tarieven={tarieven} settings={db.template_settings} entKey={ent} />}
          {docTab === 'klant' && <POPreview type="klant" ent={e} mon={prevMon} klant={selKlant} proj={selProj} form={form} tarieven={tarieven} settings={db.template_settings} entKey={ent} />}
          <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
            <button className="btn btn-sm" onClick={() => goStep(4)}>← Aanpassen</button>
            <button className="btn btn-primary btn-sm" disabled={downloading} onClick={handleDownload}>
              {downloading ? '⏳ Bezig met genereren...' : '⬇ Download overeenkomsten (ZIP)'}
            </button>
          </div>
        </div>
      )}

      {/* MODAL: persoonsnummer ontbreekt */}
      {persnrModal && (
        <div className="modal-bg">
          <div className="modal">
            <div className="modal-title">⚠ Persoonsnummer ontbreekt</div>
            <p style={{ fontSize: 13, color: '#555', marginBottom: 12 }}>
              <strong>{persnrModal.naam}</strong> heeft nog geen persoonsnummer voor <strong>{e.naam}</strong>.
              Voer het persoonsnummer in — dit wordt opgeslagen in het profiel van de monteur.
            </p>
            <div className="fg">
              <label className="flbl">Persoonsnummer {ent === 'west' ? '(bijv. W134)' : '(bijv. 284)'}</label>
              <input className="finput" value={persnrInput} onChange={ev => setPersnrInput(ev.target.value)}
                placeholder={ent === 'west' ? 'W134' : '284'}
                onKeyDown={ev => ev.key === 'Enter' && savePersnr()} autoFocus />
            </div>
            <div className="modal-footer">
              <button className="btn btn-sm" onClick={() => setPersnrModal(null)}>Annuleren</button>
              <button className="btn btn-primary btn-sm" onClick={savePersnr} disabled={!persnrInput.trim()}>Opslaan & doorgaan</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── PO PREVIEW ────────────────────────────────────────────────────────────
function POPreview({ type, ent, mon, klant, proj, form, tarieven, settings, entKey }) {
  const persnr = getPersnr(mon, entKey)
  const combo = `${proj.nr} + ${persnr}`
  const start = fmtDate(form.start)
  const signdate = fmtDate(form.signdate)
  const omschr = form.omschr || proj.omschr
  const tzzp = fmtEuro(tarieven[`${mon.id}_zzp`])
  const tkl = fmtEuro(tarieven[`${mon.id}_kl`])
  const reis = tarieven[`${mon.id}_reis`] ? ` + reisuur: ${fmtEuro(tarieven[`${mon.id}_reis`])}` : ''
  const tb = klant.tekenbevoegden.find(t => t.id === proj.tb_id) || klant.tekenbevoegden[0] || { naam: '[tekenbevoegde]' }

  const rows_zzp = [
    ['KLANT', klant.naam], ['PROJECTNAAM', proj.naam], ['PROJECT ADRES', proj.werkadres],
    ['PROJECTNUMMER', proj.nr], ['PERSOONSNUMMER', persnr], ['BETALINGSTERMIJN', (klant.betaling || '2 weken').toUpperCase()],
    ['—', ''], ['NAAM OPDRACHTNEMER', mon.naam], ['HANDELSNAAM OPDRACHTNEMER', mon.handelsnaam],
    ['KVK-NUMMER OPDRACHTNEMER', mon.kvk], ['OPDRACHTOMSCHRIJVING', omschr],
    ['STARTDATUM', start], ['EINDDATUM', settings.einddatum_default],
    ['UURTARIEF (BTW verlegd)', tzzp + reis],
    ['OPZEGTERMIJN', `Voor beide partijen geldt een schriftelijke opzegtermijn van ${klant.opzeg || '5 werkdagen'}.`]
  ]
  const rows_klant = [
    ['KLANT/OPDRACHTGEVER', klant.naam], ['ADRES', klant.adres], ['KVK-NUMMER', klant.kvk],
    ['BTW-NUMMER', klant.btw], ['CONTACTPERSOON', klant.contact], ['TEKENBEVOEGDE', tb.naam],
    ['WERKADRES', proj.werkadres], ['FACTUUR EMAILADRES OPDRACHTGEVER', klant.fmail],
    ['BETALINGSTERMIJN', klant.betaling || '2 weken'], ['—', ''],
    ['NAAM ZELFSTANDIGE', mon.naam], ['HANDELSNAAM ZELFSTANDIGE', mon.handelsnaam],
    ['KVK-NUMMER ZELFSTANDIGE', mon.kvk], ['OPDRACHTOMSCHRIJVING', omschr],
    ['PROJECTNUMMER', proj.nr], ['PERSOONSNUMMER', persnr],
    ['STARTDATUM', start], ['EINDDATUM', settings.einddatum_default],
    ['UURTARIEF (BTW verlegd)', tkl + reis],
    ['OPZEGTERMIJN', `Voor beide partijen geldt een schriftelijke opzegtermijn van ${klant.opzeg || '5 werkdagen'}.`]
  ]

  const rows = type === 'zzp' ? rows_zzp : rows_klant
  const title = type === 'zzp' ? 'Projectovereenkomst ZZP' : 'Projectovereenkomst Klant'

  return (
    <div className="po-wrap">
      <div className="po-head">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <img src={ent.logo} alt={ent.naam} style={{ height: 48, objectFit: 'contain' }} />
          <div>
            <div style={{ fontSize: 9, color: '#888', maxWidth: 220, lineHeight: 1.4 }}>{ent.naam} maakt gebruik van de algemene modelovereenkomst tussenkomst {ent.model_ref}</div>
            <div style={{ fontSize: 8, color: '#bbb' }}>Versie: {settings.versie}</div>
          </div>
        </div>
        <div className="po-ent-right">
          <strong>{ent.naam}</strong><br />{ent.adres}<br />KvK nr.: {ent.kvknr}<br />BTW nr.: {ent.btwnr}<br />{ent.email}<br />{ent.web}
        </div>
      </div>
      <div className="po-title">{title}</div>
      <div className="po-nr"><strong>Projectnummer + persoonsnummer:</strong> {combo}</div>
      <div className="po-parties">
        <strong>De ondergetekenden:</strong><br /><br />
        {type === 'zzp' ? <>
          <strong>I.</strong>&nbsp; {ent.bedrijfsnaam_zzp}, gevestigd aan de {ent.adres}, ten deze rechtsgeldig vertegenwoordigd door de heer {ent.signer_zzp},<br />
          <em>Hierna te noemen: 'Opdrachtgever';</em><br /><br />
          <strong>II.</strong>&nbsp; <strong>Bedrijfsnaam:</strong> {mon.handelsnaam}<br />
          <strong>Adres:</strong> {mon.adres}<br />
          ten deze rechtsgeldig vertegenwoordigd door naam: {mon.naam}<br />
          <em>Hierna te noemen: 'Opdrachtnemer';</em>
        </> : <>
          <strong>I.</strong>&nbsp; {klant.naam}, gevestigd aan de {klant.adres}, te dezen rechtsgeldig vertegenwoordigd door {tb.naam};<br />
          <em>Hierna te noemen: 'Opdrachtgever';</em><br /><br />
          <strong>II.</strong>&nbsp; {ent.bedrijfsnaam_klant}, gevestigd aan de {ent.adres}, te dezen rechtsgeldig vertegenwoordigd door de heer {ent.signer_klant};<br />
          <em>Hierna te noemen: 'Opdrachtnemer';</em>
        </>}
      </div>
      <div className="po-agreed">Verklaren te zijn overeengekomen als volgt:</div>
      <table className="po-tbl">
        <tbody>
          {rows.map(([k, v], i) => k === '—'
            ? <tr key={i}><td colSpan={2} style={{ height: 4, border: 'none', background: 'white' }} /></tr>
            : <tr key={i}><td className="po-lbl">{k}</td><td>{v}</td></tr>
          )}
        </tbody>
      </table>
      {klant.afw && klant.afw.length > 0 && (
        <div className="afw-box" style={{ margin: '8px 0' }}>
          <div className="afw-title">⚠ Klantspecifieke afwijkingen toegepast</div>
          {klant.afw.map((a, i) => <div key={i} className="afw-item">{a}</div>)}
        </div>
      )}
      {type === 'zzp' ? (
        <div className="zzp-sign">
          <div><div style={{ fontWeight: 700, marginBottom: 14 }}>HANDTEKENING {ent.naam}</div><div className="zzp-dots">………………………………………</div></div>
          <div><div style={{ fontWeight: 700, marginBottom: 14 }}>HANDTEKENING OPDRACHTNEMER</div><div className="zzz-dots">………………………………………</div></div>
        </div>
      ) : (
        <table className="sign-tbl">
          <tbody>
            <tr><td className="slbl">Akkoord gegaan door Opdrachtgever:</td><td>{tb.naam}</td></tr>
            <tr><td className="slbl">Handtekening:</td><td className="sspace" /></tr>
            <tr><td className="slbl">Akkoord gegaan door Opdrachtnemer</td><td>{ent.naam}<br />{ent.signer_klant}</td></tr>
            <tr><td className="slbl">Datum akkoord gegaan:</td><td>{signdate}</td></tr>
            <tr><td className="slbl">Handtekening</td><td className="sspace" /></tr>
          </tbody>
        </table>
      )}
      <div className="po-foot">Copyright © (alle rechten voorbehouden)</div>
    </div>
  )
}

// ── MONTEURS BEHEER ───────────────────────────────────────────────────────
function MonteursScreen({ db, save, toast }) {
  const [modal, setModal] = useState(null)
  const [form, setForm] = useState({})
  const [zoek, setZoek] = useState('')

  function openNieuw() { setForm({ naam: '', handelsnaam: '', kvk: '', adres: '', persnr: '', persnr_nl: '', persnr_west: '' }); setModal('nieuw') }
  function openEdit(m) { setForm({ persnr_nl: '', persnr_west: '', ...m }); setModal('edit') }
  function del(id) { if (!confirm('Monteur verwijderen?')) return; save({ ...db, monteurs: db.monteurs.filter(m => m.id !== id) }); toast('Verwijderd') }

  function saveForm() {
    // Zorg dat persnr gevuld is (backwards compat)
    const f = { ...form }
    if (!f.persnr) f.persnr = f.persnr_nl || f.persnr_west || ''
    if (modal === 'nieuw') {
      save({ ...db, monteurs: [...db.monteurs, { ...f, id: uid() }] })
      toast('Monteur toegevoegd')
    } else {
      save({ ...db, monteurs: db.monteurs.map(m => m.id === f.id ? f : m) })
      toast('Monteur bijgewerkt')
    }
    setModal(null)
  }

  const filtered = db.monteurs.filter(m =>
    m.naam.toLowerCase().includes(zoek.toLowerCase()) ||
    (m.handelsnaam || '').toLowerCase().includes(zoek.toLowerCase())
  )

  return (
    <div>
      <div className="card">
        <div className="card-hdr">
          <span>Monteurs ({db.monteurs.length})</span>
          <button className="btn btn-primary btn-sm" onClick={openNieuw}>+ Toevoegen</button>
        </div>
        <input className="finput" placeholder="🔍 Zoek monteur of bedrijfsnaam..." value={zoek}
          onChange={e => setZoek(e.target.value)} style={{ marginBottom: 10 }} />
        {filtered.map(m => {
          const nlNr = m.persnr_nl || (!m.persnr?.startsWith('W') ? m.persnr : '')
          const westNr = m.persnr_west || (m.persnr?.startsWith('W') ? m.persnr : '')
          return (
            <div key={m.id} className="list-item">
              <div className="av av-blue">{av(m.naam)}</div>
              <div className="pinfo">
                <div className="pname">{m.naam}</div>
                <div className="psub">
                  {m.handelsnaam} · KvK: {m.kvk}
                  {nlNr && <span className="badge badge-nl" style={{ marginLeft: 6 }}>NL #{nlNr}</span>}
                  {westNr && <span className="badge badge-west" style={{ marginLeft: 4 }}>West #{westNr}</span>}
                </div>
              </div>
              <button className="btn btn-sm" onClick={() => openEdit(m)}>Bewerken</button>
              <button className="btn btn-sm btn-danger" onClick={() => del(m.id)}>×</button>
            </div>
          )
        })}
      </div>

      {modal && (
        <div className="modal-bg" onClick={e => e.target.className === 'modal-bg' && setModal(null)}>
          <div className="modal">
            <div className="modal-title">{modal === 'nieuw' ? 'Monteur toevoegen' : 'Monteur bewerken'}</div>
            <div className="form-grid-2">
              {[['naam','Naam opdrachtnemer'],['handelsnaam','Handelsnaam'],['kvk','KvK-nummer'],['adres','Adres']].map(([f, lbl]) => (
                <div key={f} className={`fg ${f === 'adres' || f === 'naam' ? 'full' : ''}`}>
                  <label className="flbl">{lbl}</label>
                  <input className="finput" value={form[f] || ''} onChange={ev => setForm(p => ({ ...p, [f]: ev.target.value }))} />
                </div>
              ))}
              <div className="fg">
                <label className="flbl">Persoonsnummer GTO Nederland</label>
                <input className="finput" placeholder="bijv. 284" value={form.persnr_nl || ''} onChange={ev => setForm(p => ({ ...p, persnr_nl: ev.target.value }))} />
              </div>
              <div className="fg">
                <label className="flbl">Persoonsnummer GTO West</label>
                <input className="finput" placeholder="bijv. W134" value={form.persnr_west || ''} onChange={ev => setForm(p => ({ ...p, persnr_west: ev.target.value }))} />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-sm" onClick={() => setModal(null)}>Annuleren</button>
              <button className="btn btn-primary btn-sm" onClick={saveForm}>Opslaan</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── KLANTEN BEHEER ────────────────────────────────────────────────────────
function KlantenScreen({ db, save, toast }) {
  const [open, setOpen] = useState({})
  const [modal, setModal] = useState(null)
  const [ctx, setCtx] = useState({})
  const [form, setForm] = useState({})
  const [zoek, setZoek] = useState('')

  function toggle(id) { setOpen(p => ({ ...p, [id]: !p[id] })) }

  function openModal(type, klantId, extra) {
    setCtx({ type, klantId, ...extra })
    const k = db.klanten.find(x => x.id === klantId)
    if (type === 'klant-edit') setForm({ ...k })
    else if (type === 'tb-nieuw') setForm({ naam: '', functie: '' })
    else if (type === 'tb-edit') { const tb = k.tekenbevoegden.find(t => t.id === extra.tbId); setForm({ ...tb }) }
    else if (type === 'proj-nieuw') setForm({ nr: '', naam: '', werkadres: '', omschr: '', tb_id: k.tekenbevoegden[0]?.id || '' })
    else if (type === 'proj-edit') { const p = k.projecten.find(x => x.id === extra.projId); setForm({ ...p }) }
    else if (type === 'afw-edit') setForm({ afw: (k.afw || []).join('\n') })
    else if (type === 'klant-nieuw') setForm({ naam: '', adres: '', kvk: '', btw: '', contact: '', fmail: '', betaling: '2 weken', opzeg: '5 werkdagen', tekenbevoegden: [], afw: [], projecten: [] })
    setModal(type)
  }

  function saveModal() {
    let newKlanten = [...db.klanten]
    if (modal === 'klant-nieuw') {
      newKlanten.push({ ...form, id: uid(), tekenbevoegden: [], afw: [], projecten: [] })
    } else if (modal === 'klant-edit') {
      newKlanten = newKlanten.map(x => x.id === ctx.klantId ? { ...x, ...form } : x)
    } else if (modal === 'afw-edit') {
      newKlanten = newKlanten.map(x => x.id === ctx.klantId ? { ...x, afw: form.afw.split('\n').map(s => s.trim()).filter(Boolean) } : x)
    } else if (modal === 'tb-nieuw') {
      newKlanten = newKlanten.map(x => x.id === ctx.klantId ? { ...x, tekenbevoegden: [...x.tekenbevoegden, { ...form, id: uid() }] } : x)
    } else if (modal === 'tb-edit') {
      newKlanten = newKlanten.map(x => x.id === ctx.klantId ? { ...x, tekenbevoegden: x.tekenbevoegden.map(t => t.id === ctx.tbId ? { ...form } : t) } : x)
    } else if (modal === 'proj-nieuw') {
      newKlanten = newKlanten.map(x => x.id === ctx.klantId ? { ...x, projecten: [...x.projecten, { ...form, id: uid(), tb_id: parseInt(form.tb_id) || form.tb_id }] } : x)
    } else if (modal === 'proj-edit') {
      newKlanten = newKlanten.map(x => x.id === ctx.klantId ? { ...x, projecten: x.projecten.map(p => p.id === ctx.projId ? { ...form, tb_id: parseInt(form.tb_id) || form.tb_id } : p) } : x)
    }
    save({ ...db, klanten: newKlanten })
    toast('Opgeslagen')
    setModal(null)
  }

  function delTb(kid, tid) { if (!confirm('Verwijderen?')) return; save({ ...db, klanten: db.klanten.map(k => k.id === kid ? { ...k, tekenbevoegden: k.tekenbevoegden.filter(t => t.id !== tid) } : k) }); toast('Verwijderd') }
  function delProj(kid, pid) { if (!confirm('Verwijderen?')) return; save({ ...db, klanten: db.klanten.map(k => k.id === kid ? { ...k, projecten: k.projecten.filter(p => p.id !== pid) } : k) }); toast('Verwijderd') }

  const curKlant = ctx.klantId ? db.klanten.find(x => x.id === ctx.klantId) : null
  const filtered = db.klanten.filter(k => k.naam.toLowerCase().includes(zoek.toLowerCase()))

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center' }}>
        <input className="finput" placeholder="🔍 Zoek klant..." value={zoek}
          onChange={e => setZoek(e.target.value)} style={{ flex: 1 }} />
        <button className="btn btn-primary btn-sm" onClick={() => openModal('klant-nieuw', null)}>+ Klant toevoegen</button>
      </div>

      {filtered.map(k => (
        <div key={k.id} className="klant-card">
          <div className="klant-head" onClick={() => toggle(k.id)}>
            <div className="av av-coral">{av(k.naam)}</div>
            <div className="pinfo">
              <div className="pname">{k.naam}</div>
              <div className="psub">KvK: {k.kvk} · {k.projecten.length} project(en) · {k.tekenbevoegden.length} tekenbevoegde(n)</div>
            </div>
            {k.afw && k.afw.length > 0 && <span className="badge badge-afw">Afwijkingen</span>}
            <span style={{ color: '#bbb', fontSize: 16, marginLeft: 8 }}>{open[k.id] ? '▲' : '▼'}</span>
          </div>

          {open[k.id] && (
            <div className="klant-body">
              <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
                <button className="btn btn-sm" onClick={() => openModal('klant-edit', k.id)}>✏ Bedrijfsgegevens</button>
                <button className="btn btn-sm" onClick={() => openModal('afw-edit', k.id)}>⚠ Afwijkingen ({(k.afw || []).length})</button>
              </div>

              <div className="section-lbl">Tekenbevoegden</div>
              {k.tekenbevoegden.map(tb => (
                <div key={tb.id} className="list-item" style={{ marginBottom: 4 }}>
                  <div className="av av-blue" style={{ width: 28, height: 28, fontSize: 10 }}>{av(tb.naam)}</div>
                  <div className="pinfo"><div style={{ fontSize: 12, fontWeight: 600 }}>{tb.naam}</div><div className="psub">{tb.functie}</div></div>
                  <button className="btn btn-sm" onClick={() => openModal('tb-edit', k.id, { tbId: tb.id })}>Bewerken</button>
                  <button className="btn btn-sm btn-danger" onClick={() => delTb(k.id, tb.id)}>×</button>
                </div>
              ))}
              <button className="add-btn" onClick={() => openModal('tb-nieuw', k.id)}>+ Tekenbevoegde toevoegen</button>

              <div className="section-lbl" style={{ marginTop: 12 }}>Projecten</div>
              {k.projecten.map(p => {
                const tb = k.tekenbevoegden.find(t => t.id === p.tb_id) || { naam: '—' }
                return (
                  <div key={p.id} style={{ background: '#f8f8f8', borderRadius: 6, padding: '8px 10px', marginBottom: 6, border: '1px solid #eee' }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                      <div style={{ fontSize: 18 }}>📁</div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 600, fontSize: 13 }}>{p.naam} <span style={{ fontWeight: 400, fontSize: 11, color: '#999' }}>Nr: {p.nr}</span></div>
                        <div style={{ fontSize: 11, color: '#888' }}>{p.werkadres}</div>
                        <div style={{ fontSize: 11, color: '#888' }}>{p.omschr}</div>
                        <div style={{ fontSize: 11, color: '#4a7c9e', marginTop: 2 }}>Tekenbevoegde: {tb.naam}</div>
                      </div>
                      <button className="btn btn-sm" onClick={() => openModal('proj-edit', k.id, { projId: p.id })}>Bewerken</button>
                      <button className="btn btn-sm btn-danger" onClick={() => delProj(k.id, p.id)}>×</button>
                    </div>
                  </div>
                )
              })}
              {/* PROJECT TOEVOEGEN — direct zichtbaar onderaan projecten */}
              <button className="add-btn" onClick={() => openModal('proj-nieuw', k.id)}>+ Project toevoegen</button>
            </div>
          )}
        </div>
      ))}

      {modal && (
        <div className="modal-bg" onClick={e => e.target.className === 'modal-bg' && setModal(null)}>
          <div className="modal">
            <div className="modal-title">{{ 'klant-nieuw':'Klant toevoegen','klant-edit':'Bedrijfsgegevens bewerken','afw-edit':'Afwijkingen','tb-nieuw':'Tekenbevoegde toevoegen','tb-edit':'Tekenbevoegde bewerken','proj-nieuw':'Project toevoegen','proj-edit':'Project bewerken' }[modal]}</div>

            {(modal === 'klant-nieuw' || modal === 'klant-edit') && (
              <div className="form-grid-2">
                {[['naam','Bedrijfsnaam'],['adres','Adres'],['kvk','KvK-nummer'],['btw','BTW-nummer'],['contact','Contactpersoon'],['fmail','Factuur e-mail'],['betaling','Betalingstermijn'],['opzeg','Opzegtermijn']].map(([f, lbl]) => (
                  <div key={f} className={`fg ${f === 'naam' || f === 'adres' ? 'full' : ''}`}>
                    <label className="flbl">{lbl}</label>
                    <input className="finput" value={form[f] || ''} onChange={ev => setForm(p => ({ ...p, [f]: ev.target.value }))} />
                  </div>
                ))}
              </div>
            )}
            {modal === 'afw-edit' && (
              <>
                <p style={{ fontSize: 12, color: '#888', marginBottom: 8 }}>Één afwijking per regel.</p>
                <textarea className="finput" rows={8} style={{ fontSize: 12 }} value={form.afw || ''} onChange={ev => setForm(p => ({ ...p, afw: ev.target.value }))} />
              </>
            )}
            {(modal === 'tb-nieuw' || modal === 'tb-edit') && (
              <div className="form-grid-2">
                <div className="fg full"><label className="flbl">Naam</label><input className="finput" value={form.naam || ''} onChange={ev => setForm(p => ({ ...p, naam: ev.target.value }))} /></div>
                <div className="fg full"><label className="flbl">Functie</label><input className="finput" value={form.functie || ''} onChange={ev => setForm(p => ({ ...p, functie: ev.target.value }))} /></div>
              </div>
            )}
            {(modal === 'proj-nieuw' || modal === 'proj-edit') && (
              <div className="form-grid-2">
                <div className="fg"><label className="flbl">Projectnummer (van klant)</label><input className="finput" value={form.nr || ''} onChange={ev => setForm(p => ({ ...p, nr: ev.target.value }))} /></div>
                <div className="fg"><label className="flbl">Projectnaam</label><input className="finput" value={form.naam || ''} onChange={ev => setForm(p => ({ ...p, naam: ev.target.value }))} /></div>
                <div className="fg full"><label className="flbl">Werkadres</label><input className="finput" value={form.werkadres || ''} onChange={ev => setForm(p => ({ ...p, werkadres: ev.target.value }))} /></div>
                <div className="fg full"><label className="flbl">Opdrachtomschrijving</label><textarea className="finput" rows={2} value={form.omschr || ''} onChange={ev => setForm(p => ({ ...p, omschr: ev.target.value }))} /></div>
                <div className="fg full">
                  <label className="flbl">Tekenbevoegde</label>
                  <select className="finput" value={form.tb_id || ''} onChange={ev => setForm(p => ({ ...p, tb_id: ev.target.value }))}>
                    <option value="">— Kies tekenbevoegde —</option>
                    {curKlant?.tekenbevoegden.map(t => <option key={t.id} value={t.id}>{t.naam}</option>)}
                  </select>
                </div>
              </div>
            )}
            <div className="modal-footer">
              <button className="btn btn-sm" onClick={() => setModal(null)}>Annuleren</button>
              <button className="btn btn-primary btn-sm" onClick={saveModal}>Opslaan</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── INSTELLINGEN ──────────────────────────────────────────────────────────
function InstellingenScreen({ db, save, toast }) {
  const [ts, setTs] = useState({ ...db.template_settings })
  function saveSets() { save({ ...db, template_settings: ts }); toast('Instellingen opgeslagen') }

  return (
    <div className="card">
      <div className="card-hdr">Template instellingen</div>
      <p style={{ fontSize: 12, color: '#888', marginBottom: 16 }}>Aanpassingen hier worden direct toegepast op alle nieuwe overeenkomsten.</p>
      {[
        ['versie','Versienummer (bijv. 1/2026)'],
        ['einddatum_default','Standaard einddatum'],
        ['nl_zzp_footer_text','Modelovereenkomst referentie NL'],
        ['west_zzp_footer_text','Modelovereenkomst referentie West'],
      ].map(([f, lbl]) => (
        <div key={f} className="fg" style={{ marginBottom: 10 }}>
          <label className="flbl">{lbl}</label>
          <input className="finput" value={ts[f] || ''} onChange={ev => setTs(p => ({ ...p, [f]: ev.target.value }))} />
        </div>
      ))}
      <div style={{ marginTop: 16 }}><button className="btn btn-primary btn-sm" onClick={saveSets}>Opslaan</button></div>
      <div className="divider" style={{ margin: '20px 0' }} />
      <div className="card-hdr" style={{ marginBottom: 8 }}>Data beheer</div>
      <p style={{ fontSize: 12, color: '#888', marginBottom: 12 }}>Export en import van alle data als JSON backup.</p>
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn btn-sm" onClick={() => {
          const blob = new Blob([JSON.stringify(db, null, 2)], { type: 'application/json' })
          const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `gto_backup_${new Date().toISOString().slice(0,10)}.json`; a.click()
          toast('Backup gedownload')
        }}>⬇ Download backup (JSON)</button>
        <label className="btn btn-sm" style={{ cursor: 'pointer' }}>
          ⬆ Herstel backup
          <input type="file" accept=".json" style={{ display: 'none' }} onChange={ev => {
            const f = ev.target.files[0]; if (!f) return
            const r = new FileReader(); r.onload = e => { try { save(JSON.parse(e.target.result)); toast('Backup hersteld') } catch { toast('Fout: ongeldig bestand') } }; r.readAsText(f)
          }} />
        </label>
      </div>
    </div>
  )
}
